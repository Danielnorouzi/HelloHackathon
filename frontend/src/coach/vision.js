// In-browser computer vision (MediaPipe Tasks): body pose + ball detection. Frames never leave
// the device. The WASM runtime is bundled from node_modules; the model files load from /models/
// if you've run `npm run fetch-models` (offline demos), otherwise from Google's CDN.
import { ObjectDetector, PoseLandmarker } from '@mediapipe/tasks-vision'
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'

export const MODELS = {
  pose: {
    file: 'pose_landmarker_full.task',
    cdn: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
  },
  poseLite: {
    file: 'pose_landmarker_lite.task',
    cdn: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
  },
  ball: {
    file: 'efficientdet_lite0.tflite',
    cdn: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/latest/efficientdet_lite0.tflite',
  },
}
const FULL_POSE_BUDGET_MS = 40    // if the full pose model is slower than this, use the lite one

async function modelUrl({ file, cdn }) {
  try {
    const res = await fetch(`/models/${file}`, { method: 'HEAD' })
    if (res.ok && !(res.headers.get('content-type') || '').includes('text/html')) return `/models/${file}`
  } catch { /* not vendored: use the CDN */ }
  return cdn
}

const FILESET = { wasmLoaderPath, wasmBinaryPath }

/**
 * Create a task on GPU and on CPU, time a few real detections on the live video, keep the faster.
 * (Which is faster depends a lot on the machine and browser.) Benchmark timestamps stay below
 * performance.now() so the live loop's timestamps remain strictly increasing for the kept task.
 */
async function fastest(Task, options, input) {
  const candidates = []
  for (const delegate of ['GPU', 'CPU']) {
    let task
    try {
      task = await Task.createFromOptions(FILESET, { ...options, baseOptions: { ...options.baseOptions, delegate } })
      let ts = performance.now() - 1000
      for (let i = 0; i < 2; i++) task.detectForVideo(input(), (ts += 1))
      const t0 = performance.now()
      for (let i = 0; i < 4; i++) task.detectForVideo(input(), (ts += 1))
      candidates.push({ task, delegate, ms: (performance.now() - t0) / 4 })
    } catch {
      task?.close()
    }
  }
  if (!candidates.length) throw new Error('Could not start the tracking models in this browser.')
  candidates.sort((a, b) => a.ms - b.ms)
  candidates.slice(1).forEach((c) => c.task.close())
  return candidates[0]
}

/** Load the models, choosing the fastest backend for this device. Returns { pose, ball, info, close }. */
export async function loadVision(video) {
  const poseOptions = (url) => ({
    baseOptions: { modelAssetPath: url }, runningMode: 'VIDEO', numPoses: 1,
    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  })
  const crop = document.createElement('canvas')
  crop.width = crop.height = 384
  const cropInput = () => { crop.getContext('2d').drawImage(video, 0, 0, 384, 384); return crop }

  let pose = await fastest(PoseLandmarker, poseOptions(await modelUrl(MODELS.pose)), () => video)
  let poseModel = 'full'
  if (pose.ms > FULL_POSE_BUDGET_MS) {
    const lite = await fastest(PoseLandmarker, poseOptions(await modelUrl(MODELS.poseLite)), () => video)
    if (lite.ms < pose.ms) { pose.task.close(); pose = lite; poseModel = 'lite' } else lite.task.close()
  }
  const ball = await fastest(ObjectDetector, {
    baseOptions: { modelAssetPath: await modelUrl(MODELS.ball) }, runningMode: 'VIDEO',
    categoryAllowlist: ['sports ball'], scoreThreshold: 0.25, maxResults: 3,
  }, cropInput)
  return {
    pose: pose.task, ball: ball.task,
    info: { poseModel, poseDelegate: pose.delegate, ballDelegate: ball.delegate, poseMs: Math.round(pose.ms), ballMs: Math.round(ball.ms) },
    close: () => { pose.task.close(); ball.task.close() },
  }
}

/** Pose landmarks in pixels ({x, y, v}) or null. */
export function detectPose(pose, video, timestampMs) {
  const result = pose.detectForVideo(video, timestampMs)
  const lm = result.landmarks?.[0]
  if (!lm) return null
  const w = video.videoWidth, h = video.videoHeight
  return lm.map((p) => ({ x: p.x * w, y: p.y * h, v: p.visibility ?? 0 }))
}

/**
 * Ball detections in pixels. A football is small in a full frame, so when we know where the feet
 * are we search a crop around them (scaled up by the detector); every `fullEvery`-th call searches
 * the whole frame so a ball that flew off can be found again.
 */
export function createBallFinder(detector, { fullEvery = 6 } = {}) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: false })
  let calls = 0
  return function findBall(video, timestampMs, roi) {
    calls += 1
    const w = video.videoWidth, h = video.videoHeight
    const useRoi = roi && calls % fullEvery !== 0
    const box = useRoi ? roi : { x: 0, y: 0, w, h }
    let source = video
    if (useRoi) {
      canvas.width = Math.round(box.w)
      canvas.height = Math.round(box.h)
      ctx.drawImage(video, box.x, box.y, box.w, box.h, 0, 0, canvas.width, canvas.height)
      source = canvas
    }
    const result = detector.detectForVideo(source, timestampMs)
    return (result.detections || []).map((d) => {
      const bb = d.boundingBox
      const scale = useRoi ? box.w / canvas.width : 1
      return {
        x: box.x + (bb.originX + bb.width / 2) * scale,
        y: box.y + (bb.originY + bb.height / 2) * scale,
        r: (Math.max(bb.width, bb.height) / 2) * scale,
        score: d.categories?.[0]?.score ?? 0,
      }
    })
  }
}

/** Square search area around the feet, sized in leg lengths, clamped to the frame. */
export function feetRoi(body, legLength, width, height) {
  if (!body || !legLength) return null
  const feet = [body.left.ankle, body.right.ankle].filter((p) => p.v > 0.4)
  if (!feet.length) return null
  const cx = feet.reduce((s, p) => s + p.x, 0) / feet.length
  const cy = feet.reduce((s, p) => s + p.y, 0) / feet.length
  const size = Math.min(Math.max(2.8 * legLength, 160), Math.min(width, height))
  const x = Math.max(0, Math.min(width - size, cx - size / 2))
  const y = Math.max(0, Math.min(height - size, cy - size * 0.6))
  return { x, y, w: size, h: size }
}

/** Average brightness 0–255 from a tiny thumbnail (for the "too dark" warning). */
export function createLumaMeter() {
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 18
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  return (video) => {
    ctx.drawImage(video, 0, 0, 32, 18)
    const { data } = ctx.getImageData(0, 0, 32, 18)
    let sum = 0
    for (let i = 0; i < data.length; i += 4) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    return sum / (data.length / 4)
  }
}

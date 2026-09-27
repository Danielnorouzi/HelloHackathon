// Optional: download the two MediaPipe model files into public/models/ so the Live Skills Coach
// works without internet (the WASM runtime is already bundled from node_modules).
//   npm run fetch-models
import { mkdir, writeFile } from 'node:fs/promises'

const MODELS = {
  'pose_landmarker_full.task': 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
  'pose_landmarker_lite.task': 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
  'efficientdet_lite0.tflite': 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/latest/efficientdet_lite0.tflite',
}

await mkdir(new URL('../public/models/', import.meta.url), { recursive: true })
for (const [file, url] of Object.entries(MODELS)) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`)
  const data = Buffer.from(await res.arrayBuffer())
  await writeFile(new URL(`../public/models/${file}`, import.meta.url), data)
  console.log(`saved public/models/${file} (${(data.length / 1e6).toFixed(1)} MB)`)
}

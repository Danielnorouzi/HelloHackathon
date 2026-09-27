// Voice output and push-to-talk input for the coach.
//  • speak(): the server's AI voice (streamed MP3, API key stays on the server). If that's off or
//    fails, the browser's built-in speech synthesis is used; if neither exists, cues stay on screen.
//  • recordQuestion(): asks for microphone permission only when the player presses "Ask", records
//    until they release, and returns the audio (sent once for transcription, never stored).

export function createVoice({ onSpeakingChange } = {}) {
  let enabled = true
  let serverVoice = false
  let serverFailures = 0
  let current = null            // { stop() }
  let speaking = false

  const setSpeaking = (value) => {
    speaking = value
    onSpeakingChange?.(value)
  }

  function stop() {
    current?.stop()
    current = null
    setSpeaking(false)
  }

  function speakBrowser(text) {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) return resolve('none')
      const u = new SpeechSynthesisUtterance(text)
      const voice = window.speechSynthesis.getVoices().find((v) => v.lang?.startsWith('en'))
      if (voice) u.voice = voice
      u.rate = 1.05
      u.onend = u.onerror = () => resolve('browser')
      current = { stop: () => window.speechSynthesis.cancel() }
      window.speechSynthesis.speak(u)
    })
  }

  function speakServer(text, cache) {
    return new Promise((resolve, reject) => {
      const audio = new Audio(`/api/coach/tts?text=${encodeURIComponent(text)}&cache=${cache ? 'true' : 'false'}`)
      let started = false
      audio.onplaying = () => { started = true }
      audio.onended = () => resolve('server')
      audio.onerror = () => (started ? resolve('server') : reject(new Error('server voice unavailable')))
      current = { stop: () => { audio.pause(); audio.src = '' } }
      audio.play().catch(reject)
    })
  }

  /** Speak text; resolves with 'server' | 'browser' | 'none' once finished. */
  async function speak(text, { cache = true } = {}) {
    if (!enabled || !text) return 'none'
    stop()
    setSpeaking(true)
    try {
      if (serverVoice) {
        try {
          const how = await speakServer(text, cache)
          serverFailures = 0
          return how
        } catch {
          serverFailures += 1
          if (serverFailures >= 2) serverVoice = false   // stop trying; browser voice from now on
        }
      }
      return await speakBrowser(text)
    } finally {
      current = null
      setSpeaking(false)
    }
  }

  return {
    speak,
    stop,
    setEnabled(value) { enabled = value; if (!value) stop() },
    setServerVoice(value) { serverVoice = value; serverFailures = 0 },
    get enabled() { return enabled },
    get speaking() { return speaking },
    get browserVoiceAvailable() { return typeof window !== 'undefined' && !!window.speechSynthesis },
  }
}

/** Start recording a spoken question. Returns { stop(): Promise<Blob> }. Throws if permission is denied. */
export async function recordQuestion({ maxMs = 15000 } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => window.MediaRecorder?.isTypeSupported?.(m))
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  const chunks = []
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const done = new Promise((resolve) => {
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())   // release the microphone straight away
      resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))
    }
  })
  recorder.start()
  const timer = setTimeout(() => recorder.state === 'recording' && recorder.stop(), maxMs)
  return {
    stop() {
      clearTimeout(timer)
      if (recorder.state === 'recording') recorder.stop()
      return done
    },
  }
}

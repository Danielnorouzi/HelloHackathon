// Ball-missing alert: a short, soft chime instead of speaking "ball not detected".
//
// Debounce rules (all times in ms, passed in explicitly so the logic is testable):
//   • at most one chime every `minGapMs`;
//   • at most `maxRepeats` chimes while the ball stays missing;
//   • the count resets only after the ball has been visible again for `rearmAfterSeenMs`
//     (a one-frame detection doesn't restart the sequence);
//   • never plays while muted (and muted time doesn't use up the repeats).

/** Tracking cues that are about the ball not being visible: these get the chime, not speech. */
export const BALL_ALERT_KEYS = ['tracking:no_ball', 'tracking:ball_not_at_contact', 'tracking:ball_not_tracked']
export const isBallAlert = (cue) => !!cue && BALL_ALERT_KEYS.includes(cue.key)

export function createBallAlert({ minGapMs = 8000, maxRepeats = 3, rearmAfterSeenMs = 1500 } = {}) {
  let lastAt = -Infinity
  let repeats = 0
  let seenSince = null
  return {
    /** Call when the ball is (or isn't) visible. Returns true when a chime should play now. */
    update({ now, ballMissing, muted }) {
      if (!ballMissing) {
        seenSince ??= now
        if (now - seenSince >= rearmAfterSeenMs) repeats = 0
        return false
      }
      seenSince = null
      if (muted || repeats >= maxRepeats || now - lastAt < minGapMs) return false
      lastAt = now
      repeats += 1
      return true
    },
    get repeats() { return repeats },
  }
}

let audioContext = null

/** Two quiet descending tones (~0.25 s). Silent if the browser has no Web Audio. */
export function playChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) return
    audioContext ??= new AudioCtx()
    const ctx = audioContext
    if (ctx.state === 'suspended') ctx.resume()
    const start = ctx.currentTime
    for (const [i, freq] of [[0, 880], [1, 660]]) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const t0 = start + i * 0.12
      gain.gain.setValueAtTime(0.0001, t0)
      gain.gain.exponentialRampToValueAtTime(0.06, t0 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.11)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0)
      osc.stop(t0 + 0.12)
    }
  } catch { /* audio is a nice-to-have; tracking keeps working */ }
}

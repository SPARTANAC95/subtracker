const SOUND_KEY = 'st-sound'

let audioCtx = null

// Storage access can throw (privacy modes, "block site data" settings). A
// module-level read that throws would take the whole app down at import
// time, so every touch of localStorage here is guarded.
function readEnabled() {
  try { return localStorage.getItem(SOUND_KEY) !== 'false' } catch { return true }
}

let enabled = readEnabled()

function getCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  // Browsers start contexts suspended until a user gesture; every call site
  // is gesture-driven, so resuming here is enough to make the first click
  // audible instead of silently dropped.
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})
  return audioCtx
}

function playTone(freq, duration = 0.1, type = 'sine', volume = 0.15) {
  if (!enabled) return
  try {
    const ctx = getCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.value = freq
    gain.gain.value = volume
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + duration)
  } catch {}
}

export function playClick() {
  playTone(800, 0.05, 'sine', 0.08)
}

export function playSuccess() {
  playTone(523, 0.1, 'sine', 0.12)
  setTimeout(() => playTone(659, 0.1, 'sine', 0.12), 80)
  setTimeout(() => playTone(784, 0.15, 'sine', 0.12), 160)
}

export function playDelete() {
  playTone(400, 0.15, 'triangle', 0.1)
  setTimeout(() => playTone(300, 0.2, 'triangle', 0.08), 100)
}

export function isEnabled() { return enabled }
export function setEnabled(val) {
  enabled = Boolean(val)
  try { localStorage.setItem(SOUND_KEY, enabled ? 'true' : 'false') } catch { /* preference is session-only then */ }
}

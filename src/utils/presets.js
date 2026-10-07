// Popular service presets for quick-add
export const SERVICE_PRESETS = [
  { name: 'Netflix', category: 'streaming', amount: 15.49, cycle: 'monthly', color: '#E50914' },
  { name: 'Spotify', category: 'music', amount: 10.99, cycle: 'monthly', color: '#1DB954' },
  { name: 'YouTube Premium', category: 'streaming', amount: 13.99, cycle: 'monthly', color: '#FF0000' },
  { name: 'ChatGPT Plus', category: 'ai', amount: 20, cycle: 'monthly', color: '#10A37F' },
  { name: 'Claude Pro', category: 'ai', amount: 20, cycle: 'monthly', color: '#D97706' },
  { name: 'Disney+', category: 'streaming', amount: 13.99, cycle: 'monthly', color: '#113CCF' },
  { name: 'Amazon Prime', category: 'streaming', amount: 14.99, cycle: 'monthly', color: '#FF9900' },
  { name: 'Apple Music', category: 'music', amount: 10.99, cycle: 'monthly', color: '#FA233B' },
  { name: 'iCloud+', category: 'cloud', amount: 2.99, cycle: 'monthly', color: '#007AFF' },
  { name: 'Google One', category: 'cloud', amount: 2.99, cycle: 'monthly', color: '#4285F4' },
  { name: 'Microsoft 365', category: 'software', amount: 9.99, cycle: 'monthly', color: '#00A4EF' },
  { name: 'Adobe Creative Cloud', category: 'software', amount: 54.99, cycle: 'monthly', color: '#FF0000' },
  { name: 'Notion', category: 'software', amount: 10, cycle: 'monthly', color: '#787774' },
  { name: 'GitHub Pro', category: 'software', amount: 4, cycle: 'monthly', color: '#6e40c9' },
  { name: 'Hulu', category: 'streaming', amount: 7.99, cycle: 'monthly', color: '#1CE783' },
  { name: 'HBO Max', category: 'streaming', amount: 15.99, cycle: 'monthly', color: '#B030E8' },
  { name: 'Paramount+', category: 'streaming', amount: 5.99, cycle: 'monthly', color: '#0064FF' },
  { name: 'Crunchyroll', category: 'streaming', amount: 7.99, cycle: 'monthly', color: '#F47521' },
  { name: 'Xbox Game Pass', category: 'gaming', amount: 16.99, cycle: 'monthly', color: '#107C10' },
  { name: 'PlayStation Plus', category: 'gaming', amount: 17.99, cycle: 'monthly', color: '#003087' },
  { name: 'Nintendo Online', category: 'gaming', amount: 3.99, cycle: 'monthly', color: '#E4000F' },
  { name: 'Gym Membership', category: 'fitness', amount: 40, cycle: 'monthly', color: '#EF4444' },
  { name: 'Headspace', category: 'health', amount: 12.99, cycle: 'monthly', color: '#F47D31' },
  { name: 'NordVPN', category: 'security', amount: 12.99, cycle: 'monthly', color: '#4687FF' },
  { name: 'Dropbox', category: 'cloud', amount: 11.99, cycle: 'monthly', color: '#0061FF' },
  { name: 'Slack Pro', category: 'software', amount: 8.75, cycle: 'monthly', color: '#4A154B' },
  { name: 'Figma', category: 'software', amount: 15, cycle: 'monthly', color: '#F24E1E' },
  { name: 'Midjourney', category: 'ai', amount: 10, cycle: 'monthly', color: '#4A90D9' },
  { name: 'Cursor Pro', category: 'ai', amount: 20, cycle: 'monthly', color: '#7C3AED' },
  { name: 'Apple TV+', category: 'streaming', amount: 9.99, cycle: 'monthly', color: '#555555' },
]

// Get initials for a service name (used as fallback icon)
export function getServiceInitials(name) {
  return String(name || '').split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

const PRESET_INDEX = SERVICE_PRESETS.map(preset => {
  const lower = preset.name.toLowerCase()
  const escaped = lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // The preset's full name as a run of whole words inside a longer name
  // ("Netflix Premium", "Family Spotify plan").
  return { preset, lower, within: new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`) }
})

// Find the preset a name refers to. Deliberately conservative: a loose
// substring test made "On" resolve to Amazon Prime and left a half-typed
// "New York Times" filed under Streaming because "Ne" had matched Netflix.
export function findPreset(name) {
  const lower = String(name ?? '').trim().toLowerCase()
  if (!lower) return null

  const exact = PRESET_INDEX.find(entry => entry.lower === lower)
  if (exact) return exact.preset

  // Shorter fragments are too ambiguous to guess from.
  if (lower.length < 3) return null

  // The name is the beginning of a preset ("Disney" → Disney+, "spot" →
  // Spotify), or carries a preset's whole name inside it.
  const match = PRESET_INDEX.find(entry => entry.lower.startsWith(lower))
    || PRESET_INDEX.find(entry => entry.within.test(lower))
  return match ? match.preset : null
}

// Auto-suggest category based on service name
export function suggestCategory(name) {
  const preset = findPreset(name)
  if (preset) return preset.category
  return null
}

// Get brand color for a subscription (from presets or category)
export function getBrandColor(sub) {
  const preset = findPreset(sub?.name)
  return preset?.color || null
}

// ── Service mark colors ──
// Brand colors were picked for white pages; several (PlayStation navy, Slack
// aubergine, Apple TV grey) are close to invisible as text on the app's
// near-black surface. Lift dark ones toward white until they read clearly.

const MARK_FALLBACK = { color: '#baa3e4', background: 'rgba(186, 163, 228, 0.1)' }

function parseHex(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim())
  if (!match) return null
  const value = parseInt(match[1], 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function luminance([r, g, b]) {
  const channel = value => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function getMarkColors(sub) {
  const rgb = parseHex(getBrandColor(sub))
  if (!rgb) return MARK_FALLBACK
  let readable = rgb
  for (let step = 0; step < 8 && luminance(readable) < 0.3; step++) {
    readable = readable.map(value => Math.round(value + (255 - value) * 0.18))
  }
  const [r, g, b] = readable
  return { color: `rgb(${r}, ${g}, ${b})`, background: `rgba(${r}, ${g}, ${b}, 0.13)` }
}

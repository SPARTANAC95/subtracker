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

// Find a preset by name (fuzzy match)
export function findPreset(name) {
  const lower = String(name ?? '').trim().toLowerCase()
  if (!lower) return null

  const exact = SERVICE_PRESETS.find(p => p.name.toLowerCase() === lower)
  if (exact) return exact

  // One-character input is too ambiguous for fuzzy matching (and an empty
  // string used to match Netflix because every string includes "").
  if (lower.length < 2) return null

  return SERVICE_PRESETS.find(p => p.name.toLowerCase().includes(lower)) ||
    SERVICE_PRESETS.find(p => lower.includes(p.name.toLowerCase()))
}

// Auto-suggest category based on service name
export function suggestCategory(name) {
  const preset = findPreset(name)
  if (preset) return preset.category
  return null
}

// Get brand color for a subscription (from presets or category)
export function getBrandColor(sub) {
  const preset = findPreset(sub.name)
  return preset?.color || null
}

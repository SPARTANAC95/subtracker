// Single-hue ramp for ranked chart series (largest first, fading out).
export const RANK_RAMP = ['#baa3e4', '#9c89c2', '#7f709f', '#63587c', '#4a425d']

export const rankColor = (rank) => RANK_RAMP[rank] || RANK_RAMP[RANK_RAMP.length - 1]

// Visual identity (mark colors, icons) lives in ServiceMark / the rank ramp —
// categories are only an id and a label now.
export const CATEGORIES = [
  { id: 'streaming', label: 'Streaming' },
  { id: 'music', label: 'Music' },
  { id: 'software', label: 'Software' },
  { id: 'gaming', label: 'Gaming' },
  { id: 'ai', label: 'AI Tools' },
  { id: 'news', label: 'News' },
  { id: 'cloud', label: 'Cloud' },
  { id: 'fitness', label: 'Fitness' },
  { id: 'education', label: 'Education' },
  { id: 'finance', label: 'Finance' },
  { id: 'security', label: 'Security' },
  { id: 'food', label: 'Food' },
  { id: 'transport', label: 'Transport' },
  { id: 'housing', label: 'Housing' },
  { id: 'health', label: 'Health' },
  { id: 'other', label: 'Other' },
]

export const getCategoryById = (id) => CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1]

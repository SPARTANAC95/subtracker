// Mono gold ramp for ranked chart series (top spend first, descending).
export const GOLD_RAMP = ['#facb8d', '#e1ad66', '#c28d41', '#a06f24', '#7d5411']

export const goldRampColor = (rank) => GOLD_RAMP[rank] || GOLD_RAMP[GOLD_RAMP.length - 1]

// Visual identity (mark colors, icons) lives in ServiceMark / the gold ramp —
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

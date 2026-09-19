/* eslint-disable no-control-regex -- Deliberately reject control characters in imported text. */
// Imported service links must never introduce executable URL schemes.
export function normalizeServiceUrl(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || /[\u0000-\u0020\u007f]/.test(text)) return ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^https?:\/\//i.test(text)) return ''
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
    return ['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? url.href : ''
  } catch { return '' }
}

// Quoting alone does not prevent spreadsheet formula execution.
export function csvCell(value) {
  let text = String(value ?? '')
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

export function parseAmount(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return NaN
  const number = Number(value)
  return Number.isFinite(number) ? number : NaN
}

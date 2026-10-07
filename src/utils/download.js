// One place that hands a generated file to the browser. The object URL is
// released a moment later rather than straight after click(): revoking it in
// the same tick can cancel the download before the browser has read the blob.
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

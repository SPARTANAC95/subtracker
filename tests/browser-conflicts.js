// Exercise optimistic saving against the real isolated data server.
async page => {
  const base = page.url().split('/').slice(0, 3).join('/')
  const status = await (await page.request.get(`${base}/api/status`)).json()
  if (!status.dataFile.includes('subtracker-review')) throw new Error('Use an isolated review data directory')
  const contexts = []
  const assert = (value, message) => { if (!value) throw new Error(message) }
  const errors = []
  async function open() {
    const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', reducedMotion: 'reduce' })
    contexts.push(context)
    const app = await context.newPage()
    app.setDefaultTimeout(8000)
    app.on('pageerror', error => errors.push(error.message))
    await app.goto(base)
    await app.getByRole('navigation', { name: 'Primary navigation', exact: true }).getByRole('button', { name: 'Settings', exact: true }).click()
    await app.getByRole('spinbutton', { name: 'Monthly budget' }).waitFor()
    return app
  }
  try {
    const first = await open()
    const second = await open()
    await first.getByRole('spinbutton', { name: 'Monthly budget' }).fill('101')
    await first.getByRole('button', { name: 'Save now', exact: true }).click()
    await first.getByText('Saved to your data file', { exact: true }).waitFor()
    await second.getByRole('spinbutton', { name: 'Monthly budget' }).fill('202')
    await second.getByRole('button', { name: 'Save now', exact: true }).click()
    await second.getByText('This data file changed in another browser.', { exact: true }).waitFor()
    assert((await (await page.request.get(`${base}/api/data`)).json()).settings.budget === 101, 'Stale browser overwrote the newer disk copy')
    assert(await second.evaluate(() => JSON.parse(localStorage.getItem('st-settings')).budget) === 202, 'Conflict erased local changes')
    const exported = second.waitForEvent('download')
    await second.getByRole('button', { name: 'Back up this tab', exact: true }).click()
    await (await exported).saveAs('output/playwright/conflicting-tab-backup.json')
    await second.getByRole('button', { name: 'Load disk copy', exact: true }).click()
    await second.getByRole('alertdialog').getByRole('button', { name: 'Load disk copy', exact: true }).click()
    await second.getByText('Loaded the latest disk copy', { exact: true }).waitFor()
    assert(await second.evaluate(() => JSON.parse(localStorage.getItem('st-settings')).budget) === 101, 'Latest disk copy did not load')
    await second.getByRole('spinbutton', { name: 'Monthly budget' }).fill('303')
    await second.getByRole('button', { name: 'Save now', exact: true }).click()
    await second.getByText('Saved to your data file', { exact: true }).waitFor()
    assert((await (await page.request.get(`${base}/api/data`)).json()).settings.budget === 303, 'Saving did not resume after resolving the conflict')
    assert(errors.length === 0, errors.join('; '))
    return { passed: ['stale save rejected', 'both copies retained', 'local backup export', 'load latest disk copy', 'saving resumes'], runtimeErrors: errors }
  } finally { for (const context of contexts) await context.close() }
}

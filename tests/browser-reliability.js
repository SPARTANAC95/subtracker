// Mock failure cases in isolated browser contexts; no real data is mutated.
async page => {
  const base = page.url().split('/').slice(0, 3).join('/')
  const signature = await (await page.request.get(`${base}/api/status`)).json()
  if (!signature.dataFile.includes('subtracker-review')) throw new Error('Use an isolated review data directory')
  const assert = (condition, message) => { if (!condition) throw new Error(message) }
  const settings = { currency: 'USD', budget: 100, notifications: false, reminderDays: 3, rates: {} }
  const subs = [{ id: 'seed', name: 'Seed Plan', amount: 12, currency: 'USD', cycle: 'monthly', category: 'software', billingDate: '2026-09-07', paymentHistory: [] }]
  const contexts = []
  const results = []
  async function fresh(localSubs = subs) {
    const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Europe/Warsaw', serviceWorkers: 'block', reducedMotion: 'reduce' })
    contexts.push(context)
    await context.addInitScript(({ settings, subs }) => {
      if (!localStorage.getItem('test-seeded')) {
        localStorage.setItem('st-settings', JSON.stringify(settings))
        localStorage.setItem('st-subs', JSON.stringify(subs))
        localStorage.setItem('st-subs:updatedAt', '1000')
        localStorage.setItem('st-settings:updatedAt', '1000')
        localStorage.setItem('test-seeded', '1')
      }
    }, { settings, subs: localSubs })
    const app = await context.newPage()
    app.setDefaultTimeout(8000)
    return { context, app }
  }
  const navSettings = async app => {
    await app.getByRole('navigation', { name: 'Primary navigation', exact: true }).getByRole('button', { name: 'Settings', exact: true }).click()
    await app.getByRole('spinbutton', { name: 'Monthly budget' }).waitFor()
  }
  try {
    // Hydration must recover a damaged local value from IndexedDB, without
    // stamping old content as a brand-new change. No server available here.
    {
      const { context, app } = await fresh()
      await context.route('**/api/**', route => route.fulfill({ status: 200, json: { app: 'browser-only' } }))
      await app.goto(base)
      await app.getByRole('navigation', { name: 'Primary navigation', exact: true }).waitFor()
      await app.evaluate(async () => {
        const db = await new Promise((resolve, reject) => { const req = indexedDB.open('subtracker-db', 1); req.onsuccess = () => resolve(req.result); req.onerror = reject })
        const recovered = JSON.parse(localStorage.getItem('st-subs'))
        recovered[0].name = 'Recovered Mirror'
        await new Promise((resolve, reject) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(recovered, 'st-subs'); tx.objectStore('kv').put(5000, 'st-subs:updatedAt'); tx.oncomplete = resolve; tx.onabort = reject })
        db.close()
        localStorage.setItem('st-subs', '{"broken":true}')
      })
      await app.reload()
      await app.getByRole('button', { name: 'Recovered Mirror Software', exact: true }).waitFor()
      assert(await app.evaluate(() => localStorage.getItem('st-subs:updatedAt') === '5000'), 'Hydration changed the recovered timestamp')
      results.push('corrupt localStorage recovers from mirror without a new timestamp')
      await app.evaluate(() => {
        sessionStorage.setItem('st-list-view', JSON.stringify({ search: 45, categoryFilter: 'invalid', sort: '__proto__' }))
        sessionStorage.setItem('st-calendar-offset', 'Infinity')
      })
      await app.getByRole('navigation', { name: 'Primary navigation', exact: true }).getByRole('button', { name: /^Subscriptions/ }).click()
      await app.getByRole('button', { name: 'Recovered Mirror Software', exact: true }).waitFor()
      await app.getByRole('navigation', { name: 'Primary navigation', exact: true }).getByRole('button', { name: 'Calendar', exact: true }).click()
      await app.getByRole('button', { name: 'Today', exact: true }).waitFor()
      assert(!(await app.locator('body').innerText()).includes('Invalid Date'), 'Corrupted calendar offset broke the view')
      results.push('malformed list preferences and infinite calendar offset are safe')
      // Two tabs share the same fast storage. Receiving a change must not
      // continually echo it back with later timestamps.
      await navSettings(app)
      const other = await context.newPage()
      await other.goto(base)
      await other.getByRole('navigation', { name: 'Primary navigation', exact: true }).waitFor()
      await app.getByRole('spinbutton', { name: 'Monthly budget' }).fill('143')
      await other.waitForFunction(() => JSON.parse(localStorage.getItem('st-settings')).budget === 143)
      const stamp = await app.evaluate(() => localStorage.getItem('st-settings:updatedAt'))
      await app.waitForTimeout(1000)
      assert(await other.evaluate(() => localStorage.getItem('st-settings:updatedAt')) === stamp, 'Cross-tab persistence is echoing changes')
      await other.reload()
      await other.getByRole('navigation', { name: 'Primary navigation', exact: true }).waitFor()
      assert(await other.evaluate(() => localStorage.getItem('st-settings:updatedAt')) === stamp, 'Reload re-stamped content')
      results.push('cross-tab update and reload retain stable content timestamps')
      await app.getByRole('button', { name: 'Add subscription', exact: true }).first().click()
      const form = app.getByRole('dialog', { name: 'New subscription' })
      await form.getByRole('button', { name: 'Close', exact: true }).focus()
      await app.keyboard.press('Shift+Tab')
      assert(await app.evaluate(() => !!document.activeElement.closest('[role="dialog"]')), 'Tab escaped the form')
      await app.keyboard.press('Control+k')
      assert(await app.getByRole('dialog', { name: 'Command palette' }).count() === 0, 'Palette opened over an unsaved form')
      await app.keyboard.press('Escape')
      await app.waitForFunction(() => !document.querySelector('[role="dialog"]'))
      assert(await app.evaluate(() => document.body.style.overflow !== 'hidden'), 'Closed form left scrolling locked')
      results.push('modal focus containment, Escape, and nested shortcut protection')
      await context.close()
    }
    // The app can launch before its data server. It must eventually retry.
    {
      const { context, app } = await fresh()
      let online = false, saved = false
      await context.route('**/api/**', async route => {
        const path = route.request().url().split('/').at(-1)
        if (path === 'status') return route.fulfill({ json: online ? { ok: true, app: 'subtracker-pro', exists: false } : { app: 'unavailable' } })
        if (route.request().method() === 'PUT') { saved = true; return route.fulfill({ json: { ok: true, savedAt: new Date().toISOString() } }) }
        return route.fulfill({ status: 404, json: {} })
      })
      await app.goto(base)
      await app.getByRole('navigation', { name: 'Primary navigation', exact: true }).waitFor()
      online = true
      await app.waitForTimeout(13000)
      assert(saved, 'Server was never retried after starting offline')
      results.push('initially unavailable server reconnects automatically')
      await context.close()
    }
    // Slow network saves drain in order; an unsuccessful reset retains data
    // and restores the ability to save afterwards.
    {
      const { context, app } = await fresh()
      let active = 0, maxActive = 0, slow = false, failedReset = false, resetSucceeds = false
      const writes = []
      const order = []
      await context.route('**/api/**', async route => {
        const request = route.request()
        if (request.url().endsWith('/status')) return route.fulfill({ json: { ok: true, app: 'subtracker-pro', exists: false } })
        if (request.method() === 'DELETE') {
          order.push('delete')
          if (resetSucceeds) return route.fulfill({ json: { ok: true } })
          failedReset = true
          return route.fulfill({ status: 503, json: { error: 'offline' } })
        }
        if (request.method() === 'PUT') {
          active++; maxActive = Math.max(maxActive, active)
          const payload = request.postDataJSON()
          if (slow) await app.waitForTimeout(1800)
          writes.push(payload)
          order.push('write')
          active--
          return route.fulfill({ json: { ok: true, savedAt: new Date().toISOString() } })
        }
        return route.fulfill({ status: 404, json: {} })
      })
      await app.goto(base)
      await navSettings(app)
      slow = true
      await app.getByRole('spinbutton', { name: 'Monthly budget' }).fill('111')
      await app.waitForTimeout(1400)
      await app.getByRole('spinbutton', { name: 'Monthly budget' }).fill('222')
      await app.waitForTimeout(4200)
      assert(maxActive === 1 && writes.at(-1).settings.budget === 222, 'Concurrent saves can overwrite newer content')
      results.push('slow saves are serialized and include edits made in flight')
      slow = false
      await app.getByRole('button', { name: 'Reset…', exact: true }).click()
      await app.getByRole('alertdialog').getByRole('button', { name: 'Reset', exact: true }).click()
      await app.getByText(/Reset failed: the data server/).waitFor()
      assert(failedReset && await app.evaluate(() => JSON.parse(localStorage.getItem('st-subs')).length === 1), 'Failed reset erased browser data')
      await app.getByRole('spinbutton', { name: 'Monthly budget' }).fill('333')
      await app.getByRole('button', { name: 'Save now', exact: true }).click()
      await app.getByText('Saved to your data file', { exact: true }).waitFor()
      assert(writes.at(-1).settings.budget === 333, 'Failed reset permanently disabled saving')
      results.push('failed reset keeps data and subsequent saves still work')
      resetSucceeds = true
      slow = true
      await app.getByRole('spinbutton', { name: 'Monthly budget' }).fill('444')
      await app.waitForTimeout(1400)
      await app.getByRole('button', { name: 'Reset…', exact: true }).click()
      await app.getByRole('alertdialog').getByRole('button', { name: 'Reset', exact: true }).click()
      await app.getByRole('heading', { name: 'Welcome to SubTracker', exact: true }).waitFor()
      assert(order.at(-1) === 'delete', 'An in-flight write ran after the reset')
      results.push('successful reset waits for pending saves and returns to setup')
      await context.close()
    }
    return { passed: results }
  } finally {
    for (const context of contexts) await context.close()
  }
}

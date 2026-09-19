# SubTracker

A local-first subscription management app for tracking recurring bills,
upcoming renewals, one-time reminders, budgets, and payment history.

![SubTracker showcase](docs/screenshots/showcase.png)

## Why this exists

A lot of subscription trackers are cloud-first, overcomplicated, or too loose
with personal finance data. SubTracker keeps things simple:

- your data stays on your own machine
- the app works offline
- subscription history and reminders are kept in a real file on disk
- recurring billing stays predictable even when you pay early or late

## Features

- **Recurring subscriptions** with monthly, weekly, yearly, quarterly,
  biweekly, and semiannual billing cycles
- **One-time reminders** for things like annual licenses, domains, prepaid
  plans, or trial endings
- **Payment history** with due-date tracking so early and late payments do not
  silently break the schedule
- **Budgeting and insights** for monthly commitment, recorded paid totals,
  upcoming spend, and category breakdowns
- **Calendar view** for billing dates and reminder end dates
- **Local-first persistence** with browser storage plus a real JSON data file
  on disk
- **Automatic recovery and backups** with previous-version snapshots and daily
  backup retention
- **Import/export tools** for full backup restore, additive import, CSV export,
  and calendar export
- **Responsive UI** for desktop and mobile
- **Keyboard shortcuts and search** for faster navigation

## Screenshots

### Overview
![Overview](docs/screenshots/overview.png)

### Calendar
![Calendar](docs/screenshots/calendar.png)

### Mobile subscriptions view
![Mobile view](docs/screenshots/mobile.png)

## Tech stack

- React 19
- Vite 7
- Tailwind CSS 4
- Framer Motion
- Local Node.js server for disk-backed persistence

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Run the app

```bash
npm run app
```

That builds the app and starts the local server at `http://localhost:5273`.

### Development mode

```bash
npm run dev
```

The Vite dev server runs at `http://127.0.0.1:5280`.

### Serve the production build without auto-opening the browser

```bash
npm run serve
```

## Windows launcher

If you want a double-click flow on Windows, use `launch.bat`.

It will:

1. check that Node.js is installed
2. build the app if needed
3. start the local server
4. open the app in your browser

## Data and privacy

SubTracker is intentionally **local-first**.

Your data is saved to a real JSON file on disk:

```text
data/subtracker-data.json
```

Additional safety copies are kept as:

```text
data/subtracker-data.json.bak
data/backups/subtracker-YYYY-MM-DD.json
```

The local server binds to loopback only. It is designed for single-user local
use and does not expose a public network service.

## Demo data

A small sample backup is included here:

```text
docs/demo-data/subtracker-demo-data.json
```

You can import or restore it from the Settings page if you want example data to
explore the UI.

## Available scripts

```bash
npm run dev      # Vite dev server
npm run build    # production build
npm run serve    # local Node server, no browser auto-open
npm run start    # local Node server with browser auto-open
npm run app      # build + start real app
npm run lint     # ESLint
npm test         # Node test suite
npm run check    # lint + tests + build
```

## Project structure

```text
src/              React app source
public/           static assets and fonts
tests/            Node tests and browser-flow scripts
server.mjs        local data server and backup logic
launch.bat        Windows launcher
```

## Roadmap ideas

- richer filtering and saved views
- clearer onboarding for reminders vs recurring plans
- optional analytics improvements
- optional packaging as a desktop app
- improved screenshot and seed-data tooling

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md).

## License

Released under the [MIT License](LICENSE).

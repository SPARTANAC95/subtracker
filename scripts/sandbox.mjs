// Runs the built app against a throwaway copy of the data, on its own port.
//
//   npm run sandbox            a copy of data/subtracker-data.json
//   npm run sandbox -- --demo  the sample library from docs/demo-data
//
// For trying changes in a browser with nothing at stake: the copy lives in the
// system temp folder, and a different port means a different browser origin,
// so neither the real data file nor the real app's browser storage is touched.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LIVE = path.join(ROOT, 'data', 'subtracker-data.json')
const DEMO = path.join(ROOT, 'docs', 'demo-data', 'subtracker-demo-data.json')

const source = !process.argv.includes('--demo') && fs.existsSync(LIVE) ? LIVE : DEMO
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subtracker-sandbox-'))
fs.copyFileSync(source, path.join(dataDir, 'subtracker-data.json'))

process.env.SUBTRACKER_PORT ||= '5299'
process.env.SUBTRACKER_DATA_DIR = dataDir

console.log(`Sandbox: a copy of ${path.relative(ROOT, source)} in ${dataDir}`)
await import(pathToFileURL(path.join(ROOT, 'server.mjs')).href)

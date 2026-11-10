// Rebuilds dist/ only when something it is built from has changed.
//
// launch.bat used to run a full `vite build` on every start, which is several
// seconds of waiting before the app opens. Nothing has usually changed since
// the last start, and checking that takes a few milliseconds.

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BUILT = path.join(ROOT, 'dist', 'index.html')
// Everything the build reads. A dependency change shows up as a new lockfile.
const INPUTS = ['src', 'public', 'index.html', 'package.json', 'package-lock.json', 'vite.config.js']

function newest(target) {
  let stat
  try { stat = fs.statSync(target) } catch { return 0 }
  if (!stat.isDirectory()) return stat.mtimeMs
  return fs.readdirSync(target).reduce((latest, name) => Math.max(latest, newest(path.join(target, name))), 0)
}

const builtAt = newest(BUILT)
const changedAt = Math.max(...INPUTS.map(name => newest(path.join(ROOT, name))))

if (builtAt && builtAt >= changedAt && !process.argv.includes('--force')) {
  console.log('SubTracker is up to date.')
  process.exit(0)
}

console.log(builtAt ? 'SubTracker changed since the last start — rebuilding…' : 'Building SubTracker for the first time…')
const result = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: true })
process.exit(result.status ?? 1)

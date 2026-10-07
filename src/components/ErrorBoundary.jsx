import React from 'react'
import { AlertTriangle, RotateCcw, Trash2, Download } from 'lucide-react'
import { formatDateOnly } from '../utils/dates'
import { buildBackupPayload, clearAllAppData } from '../utils/persistence'
import { deleteServerData } from '../utils/syncServer'
import { downloadBlob } from '../utils/download'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    if (typeof window !== 'undefined' && window.console) {
      console.error('[SubTracker] Render error:', error)
      if (info?.componentStack) console.error(info.componentStack)
    }
  }

  exportBackup = () => {
    try {
      const read = (key, fallback) => {
        try {
          const raw = localStorage.getItem(key)
          return raw ? JSON.parse(raw) : fallback
        } catch { return fallback }
      }
      const payload = buildBackupPayload({
        subs: read('st-subs', []),
        settings: read('st-settings', null),
        dismissed: read('st-dismissed', []),
      })
      downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `subtracker-recovery-${formatDateOnly(new Date())}.json`)
    } catch (e) {
      console.error('Backup failed', e)
    }
  }

  resetData = async () => {
    if (!window.confirm('This will permanently delete all subscriptions and settings. Did you save a backup first?')) return
    // Delete the server's data file first (it keeps a dated rescue copy) —
    // otherwise the next boot restores from disk and the reset undoes itself,
    // exactly what App.handleClearAll already guards against.
    try { await deleteServerData() } catch { /* server not running — browser-only mode */ }
    await clearAllAppData()
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV
      return (
        <main className="welcome">
          <div className="welcome-card !max-w-[520px]" role="alert">
            <AlertTriangle aria-hidden="true" />
            <h1>Something went wrong</h1>
            <p className="break-words">{this.state.error?.message || 'An unexpected error occurred'}</p>
            {isDev && this.state.info?.componentStack && (
              <pre className="mb-5 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-[#0d0d0f] p-3 text-left text-[10px] text-dim">{this.state.info.componentStack}</pre>
            )}
            <div className="flex flex-wrap justify-center gap-2.5">
              <button type="button" onClick={() => this.setState({ hasError: false, error: null, info: null })} className="btn btn-primary">
                <RotateCcw aria-hidden="true" /> Try again
              </button>
              <button type="button" onClick={this.exportBackup} className="btn">
                <Download aria-hidden="true" /> Save backup
              </button>
              <button type="button" onClick={this.resetData} className="btn btn-danger">
                <Trash2 aria-hidden="true" /> Reset all data
              </button>
            </div>
            <p className="fine-print mt-5">Save a backup before resetting. The same file can be restored from Settings or onboarding.</p>
          </div>
        </main>
      )
    }
    return this.props.children
  }
}

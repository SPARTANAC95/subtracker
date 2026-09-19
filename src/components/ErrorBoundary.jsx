import React from 'react'
import { AlertTriangle, RotateCcw, Trash2, Download } from 'lucide-react'
import { formatDateOnly } from '../utils/dates'
import { buildBackupPayload, clearAllAppData } from '../utils/persistence'
import { deleteServerData } from '../utils/syncServer'

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
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `subtracker-recovery-${formatDateOnly(new Date())}.json`
      a.click()
      URL.revokeObjectURL(url)
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
        <div className="min-h-screen bg-[#060605] flex items-center justify-center p-6">
          <div className="glass max-w-lg space-y-4 p-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[rgba(217,159,139,0.12)]">
              <AlertTriangle className="h-8 w-8 text-[#d99f8b]" />
            </div>
            <h2 className="font-figure text-xl font-medium text-(--app-text)">Something went wrong</h2>
            <p className="break-words text-sm text-[rgba(242,240,234,0.55)]">{this.state.error?.message || 'An unexpected error occurred'}</p>
            {isDev && this.state.info?.componentStack && (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-black/30 p-3 text-left text-[10px] text-[rgba(242,240,234,0.4)]">{this.state.info.componentStack}</pre>
            )}
            <div className="flex flex-wrap justify-center gap-2.5 pt-2">
              <button onClick={() => this.setState({ hasError: false, error: null, info: null })} className="btn btn-primary">
                <RotateCcw className="h-4 w-4" /> Try again
              </button>
              <button onClick={this.exportBackup} className="btn btn-secondary">
                <Download className="h-4 w-4" /> Save backup
              </button>
              <button onClick={this.resetData} className="btn btn-danger">
                <Trash2 className="h-4 w-4" /> Reset all data
              </button>
            </div>
            <p className="pt-2 text-xs text-[rgba(242,240,234,0.4)]">Save a backup before resetting. The same file can be restored from Settings or onboarding.</p>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

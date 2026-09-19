import { motion, AnimatePresence } from 'framer-motion'
import { Check, Loader2, AlertCircle } from 'lucide-react'

export default function SaveIndicator({ status }) {
  return (
    <AnimatePresence mode="wait">
      {status === 'saving' && (
        <motion.div key="saving" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1 text-[10px] text-[rgba(242,240,234,0.5)]">
          <Loader2 className="w-3 h-3 animate-spin" />
        </motion.div>
      )}
      {status === 'saved' && (
        <motion.div key="saved" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1 text-[10px] text-[rgba(158,200,160,0.7)]">
          <Check className="w-3 h-3" />
        </motion.div>
      )}
      {(status === 'error' || status === 'quota' || status === 'degraded') && (
        <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1 text-[10px] text-[#d99f8b]">
          <AlertCircle className="w-3 h-3" />
          <span>{status === 'quota' ? 'Full' : status === 'degraded' ? 'Backup' : 'Error'}</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

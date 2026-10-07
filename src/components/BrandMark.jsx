import { useId } from 'react'

// The SubTracker mark: a renewal loop on a carbon tile. Kept as inline SVG so
// it renders before any asset has loaded; public/icon.svg is the same drawing
// for the browser tab and the installed app.
export default function BrandMark(props) {
  // The mark appears in both the sidebar and the mobile header, and one of
  // them is always display:none — a shared gradient id would resolve to the
  // hidden copy and paint nothing.
  const gradient = `brand-mark-${useId().replace(/[^a-z0-9]/gi, '')}`
  return (
    <svg viewBox="0 0 192 192" aria-hidden="true" {...props}>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#e3d6f8" />
          <stop offset="100%" stopColor="#a48bd3" />
        </linearGradient>
      </defs>
      <rect width="192" height="192" rx="44" fill="#17161b" />
      <rect x="1.5" y="1.5" width="189" height="189" rx="42.5" fill="none" stroke="#ffffff" strokeOpacity="0.09" strokeWidth="3" />
      <path d="M140 96a44 44 0 1 1-13.6-31.8" fill="none" stroke={`url(#${gradient})`} strokeWidth="15" strokeLinecap="round" />
      <path d="M131 40v29h-29" fill="none" stroke={`url(#${gradient})`} strokeWidth="15" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="96" cy="96" r="12" fill="#e3d6f8" />
    </svg>
  )
}

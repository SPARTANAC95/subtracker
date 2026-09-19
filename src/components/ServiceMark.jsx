import { getBrandColor, getServiceInitials } from '../utils/presets'

// Rounded service chip: brand color at ~13% opacity behind brand-colored
// Space Grotesk initials, falling back to the gold accent for unknown names.
export default function ServiceMark({ sub, size = 36, radius = 11, fontSize = 12 }) {
  const brand = getBrandColor(sub)
  return (
    <span
      className="font-figure grid flex-none place-items-center border border-[rgba(242,240,234,0.07)] font-semibold"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize,
        background: brand ? `${brand}22` : 'rgba(225,173,102,0.1)',
        color: brand || '#e1ad66',
      }}
      aria-hidden="true"
    >
      {getServiceInitials(sub.name)}
    </span>
  )
}

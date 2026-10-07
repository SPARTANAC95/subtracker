import { getMarkColors, getServiceInitials } from '../utils/presets'

// Square service tile: the brand color (lifted until it is readable on the
// dark surface) over a faint tint of itself, lavender for unknown names.
export default function ServiceMark({ sub, size = 36, fontSize }) {
  const { color, background } = getMarkColors(sub)
  return (
    <span
      className="mark"
      style={{ width: size, height: size, fontSize: fontSize ?? Math.round(size / 3), background, color }}
      aria-hidden="true"
    >
      {getServiceInitials(sub.name)}
    </span>
  )
}

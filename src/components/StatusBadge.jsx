// Small bordered badge; `tone` is one of ok | accent | warn | danger | muted.
export default function StatusBadge({ tone = 'muted', children }) {
  return (
    <span className={`status ${tone}`}>
      <i aria-hidden="true" />{children}
    </span>
  )
}

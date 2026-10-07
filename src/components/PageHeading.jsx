// The title block every page opens with: one h1, an optional summary line,
// and page-level controls on the right.
export default function PageHeading({ title, id, children, actions }) {
  return (
    <header className="page-heading">
      <div className="min-w-0">
        <h1 id={id}>{title}</h1>
        {children ? <p>{children}</p> : null}
      </div>
      {actions}
    </header>
  )
}

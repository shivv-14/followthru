import { NavLink } from 'react-router-dom'
import clsx from 'clsx'
import { STATUS_LABEL, STATUS_TONE, type PageSummary } from './types'

/** Pages as a parent/child tree. A page whose parent is hidden (filtered out or not readable) shows at the top level. */
export function PageTree({ pages }: { pages: PageSummary[] }) {
  const ids = new Set(pages.map((p) => p.id))
  const children = new Map<string | null, PageSummary[]>()
  for (const p of pages) {
    const parent = p.parent_id && ids.has(p.parent_id) ? p.parent_id : null
    children.set(parent, [...(children.get(parent) ?? []), p])
  }
  const branch = (parent: string | null, depth: number, seen: Set<string>): React.ReactNode => {
    const list = children.get(parent) ?? []
    if (!list.length || depth > 12) return null
    return (
      <ul className={clsx(depth > 0 && 'ml-3 border-l border-surface-border pl-2')}>
        {list.map((p) => {
          if (seen.has(p.id)) return null
          const next = new Set(seen).add(p.id)
          return (
            <li key={p.id}>
              <NavLink
                to={`/knowledge/${p.id}`}
                className={({ isActive }) => clsx('flex items-baseline justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-hover', isActive ? 'bg-surface-hover text-text-primary' : 'text-text-muted')}
              >
                <span className="truncate">{p.title}</span>
                {p.status !== 'published' ? <span className={clsx('shrink-0 text-[11px]', STATUS_TONE[p.status])}>{STATUS_LABEL[p.status]}</span> : null}
              </NavLink>
              {branch(p.id, depth + 1, next)}
            </li>
          )
        })}
      </ul>
    )
  }
  return <nav aria-label="Pages">{branch(null, 0, new Set())}</nav>
}

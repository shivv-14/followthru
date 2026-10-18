import { createElement, Fragment, useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { parseMarkdown, type Block, type Inline } from '../../knowledge/markdown'

// Renders the markdown tree as React elements. Text always goes through React's escaping; this
// component never sets inner HTML.

function inlines(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    if (n.type === 'text') return <Fragment key={i}>{n.text}</Fragment>
    if (n.type === 'code') return <code key={i} className="rounded bg-white/[0.08] px-1 py-0.5 font-mono text-[0.9em]">{n.text}</code>
    if (n.type === 'strong') return <strong key={i} className="font-semibold text-text-primary">{inlines(n.children)}</strong>
    if (n.type === 'em') return <em key={i}>{inlines(n.children)}</em>
    const cls = 'text-accent underline underline-offset-2 hover:opacity-80'
    return n.href.startsWith('/') ? (
      <Link key={i} to={n.href} className={cls}>
        {inlines(n.children)}
      </Link>
    ) : (
      <a key={i} href={n.href} target="_blank" rel="noopener noreferrer nofollow" className={cls}>
        {inlines(n.children)}
      </a>
    )
  })
}

const HEADING_CLASS = ['text-2xl font-semibold', 'text-xl font-semibold', 'text-lg font-semibold', 'text-base font-semibold', 'text-sm font-semibold', 'text-sm font-semibold uppercase tracking-wide']

function block(b: Block, i: number): ReactNode {
  switch (b.type) {
    case 'heading':
      return createElement(`h${b.level}`, { key: i, className: `${HEADING_CLASS[b.level - 1]} mt-5 first:mt-0 text-text-primary` }, inlines(b.children))
    case 'paragraph':
      return <p key={i} className="mt-3 leading-relaxed">{inlines(b.children)}</p>
    case 'list': {
      const Tag = b.ordered ? 'ol' : 'ul'
      return (
        <Tag key={i} className={`mt-3 space-y-1 pl-6 ${b.ordered ? 'list-decimal' : 'list-disc'}`}>
          {b.items.map((it, j) => (
            <li key={j}>{inlines(it)}</li>
          ))}
        </Tag>
      )
    }
    case 'quote':
      return <blockquote key={i} className="mt-3 border-l-2 border-surface-border pl-3 italic text-text-muted">{inlines(b.children)}</blockquote>
    case 'code':
      return (
        <pre key={i} className="mt-3 overflow-x-auto rounded-md border border-surface-border bg-white/[0.04] p-3 font-mono text-xs">
          <code>{b.text}</code>
        </pre>
      )
    case 'rule':
      return <hr key={i} className="my-5 border-surface-border" />
  }
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source])
  if (blocks.length === 0) return <p className="text-sm text-text-faint">This page is empty.</p>
  return <div className={`break-words text-sm text-text-muted ${className ?? ''}`}>{blocks.map(block)}</div>
}

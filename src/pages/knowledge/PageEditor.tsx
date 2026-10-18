import { type FormEvent, useState } from 'react'
import { Button, Card, Input, Select, Textarea } from '../../components/ui'
import { Notice } from '../../components/domain/parts'
import { Markdown } from '../../components/domain/Markdown'
import { callApi } from '../../cloud/api'
import { KB_LIMITS } from '../../knowledge/rules'
import type { ActionResult } from '../../store'
import type { Page, PageSummary, Space } from './types'

interface Props {
  /** The page being edited, or null for a new page */
  page: Page | null
  spaces: Space[]
  /** Pages of the same space that can be chosen as the parent */
  candidates: PageSummary[]
  defaultSpaceId: string
  onSaved: (pageId: string) => void
  onCancel: () => void
}

/** Textarea editor with a live preview. Updates send the row version they started from; a 409 keeps the text here. */
export function PageEditor({ page, spaces, candidates, defaultSpaceId, onSaved, onCancel }: Props) {
  const [title, setTitle] = useState(page?.title ?? '')
  const [body, setBody] = useState(page?.body_md ?? '')
  const [tags, setTags] = useState((page?.tags ?? []).join(', '))
  const [spaceId, setSpaceId] = useState(page?.space_id ?? defaultSpaceId)
  const [parentId, setParentId] = useState(page?.parent_id ?? '')
  const [note, setNote] = useState('')
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<ActionResult | null>(null)
  const parents = candidates.filter((c) => c.space_id === spaceId && c.id !== page?.id)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const res = await callApi<{ pageId: string; message: string }>('kb/page-save', {
      ...(page ? { pageId: page.id, expectedRowVersion: page.row_version } : { spaceId }),
      title,
      bodyMd: body,
      tags: tags.split(','),
      parentId: parentId || null,
      note: note || undefined,
    })
    setBusy(false)
    if (res.ok) return onSaved(res.data.pageId)
    setNotice({ ok: false, message: res.error.message })
  }

  return (
    <Card>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3" aria-label={page ? `Edit ${page.title}` : 'New page'}>
        <h2 className="font-display text-lg font-semibold text-text-primary">{page ? `Editing: ${page.title}` : 'New page'}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Title" value={title} maxLength={KB_LIMITS.title} required onChange={(e) => setTitle(e.target.value)} />
          <Input label="Tags (comma separated)" value={tags} onChange={(e) => setTags(e.target.value)} hint="Letters, digits and hyphens" />
          {page ? null : (
            <Select label="Space" value={spaceId} onChange={(e) => { setSpaceId(e.target.value); setParentId('') }} required>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
          <Select label="Parent page" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">None (top level)</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </Select>
        </div>
        <div role="tablist" aria-label="Editor view" className="flex gap-2 lg:hidden">
          {(['write', 'preview'] as const).map((t) => (
            <Button key={t} role="tab" aria-selected={tab === t} size="sm" variant={tab === t ? 'secondary' : 'ghost'} onClick={() => setTab(t)}>
              {t === 'write' ? 'Write' : 'Preview'}
            </Button>
          ))}
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className={tab === 'write' ? '' : 'hidden lg:block'}>
            <Textarea label="Page text (markdown)" value={body} maxLength={KB_LIMITS.body} onChange={(e) => setBody(e.target.value)} className="min-h-80 font-mono text-xs" hint={`${body.length} / ${KB_LIMITS.body} characters. # heading, - list, **bold**, *italic*, \`code\`, [link](https://...)`} />
          </div>
          <section aria-label="Preview" className={tab === 'preview' ? '' : 'hidden lg:block'}>
            <p className="mb-1.5 text-sm font-medium text-text-primary">Preview</p>
            <div className="min-h-80 rounded-xl border border-surface-border p-3">
              <Markdown source={body} />
            </div>
          </section>
        </div>
        {page ? <Input label="Change note (optional)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /> : null}
        <Notice result={notice} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || !title.trim() || (!page && !spaceId)}>
            {busy ? 'Saving…' : page ? 'Save new version' : 'Create draft'}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  )
}

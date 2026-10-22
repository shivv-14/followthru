import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BookOpen } from 'lucide-react'
import { Button, Card, EmptyState, ErrorState, Input, LoadingState, Select } from '../components/ui'
import { Notice, PageHeader } from '../components/domain/parts'
import { callApi } from '../cloud/api'
import { useCloud } from '../cloud/session'
import { KB_STATUSES } from '../knowledge/rules'
import type { ActionResult } from '../store'
import { PageEditor } from './knowledge/PageEditor'
import { PageTree } from './knowledge/PageTree'
import { PageView } from './knowledge/PageView'
import { STATUS_LABEL, type PageDetail, type PageSummary, type Space } from './knowledge/types'

function NewSpaceForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [notice, setNotice] = useState<ActionResult | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    const res = await callApi<{ spaceId: string; message: string }>('kb/space-save', { key, name })
    setNotice(res.ok ? { ok: true, message: res.data.message } : { ok: false, message: res.error.message })
    if (res.ok) {
      setKey('')
      setName('')
      onCreated(res.data.spaceId)
    }
  }
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-accent">New space</summary>
      <form onSubmit={(e) => void submit(e)} className="mt-2 flex flex-col gap-2" aria-label="New space">
        <Input label="Name" value={name} maxLength={120} required onChange={(e) => setName(e.target.value)} />
        <Input label="Key" value={key} maxLength={40} required pattern="[a-z0-9][a-z0-9\-]*" hint="Lowercase letters, digits, hyphens" onChange={(e) => setKey(e.target.value.toLowerCase())} />
        <Button type="submit" size="sm" disabled={!key || !name}>
          Create space
        </Button>
        <Notice result={notice} />
      </form>
    </details>
  )
}

/** Knowledge base: spaces, a page tree, search and filters, page view, editor and history. */
export default function Knowledge() {
  const cloud = useCloud()
  const role = cloud?.me?.profile.role ?? 'member'
  const userId = cloud?.me?.profile.id ?? ''
  const { pageId } = useParams()
  const navigate = useNavigate()
  const [spaces, setSpaces] = useState<Space[] | null>(null)
  const [pages, setPages] = useState<PageSummary[] | null>(null)
  const [spaceId, setSpaceId] = useState('')
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [tag, setTag] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<PageDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [shownVersion, setShownVersion] = useState<number | null>(null)
  const [editing, setEditing] = useState<'new' | 'edit' | null>(null)

  const loadSpaces = useCallback(async () => {
    const res = await callApi<{ spaces: Space[] }>('kb/spaces')
    if (!res.ok) return setError(res.error.message)
    setSpaces(res.data.spaces)
  }, [])

  const loadPages = useCallback(async () => {
    const res = await callApi<{ pages: PageSummary[] }>('kb/pages', { spaceId: spaceId || undefined, q: search || undefined, status: status || undefined, tag: tag || undefined })
    if (!res.ok) return setError(res.error.message)
    setError(null)
    setPages(res.data.pages)
  }, [spaceId, search, status, tag])

  const loadDetail = useCallback(async () => {
    if (!pageId) return setDetail(null)
    const res = await callApi<PageDetail>('kb/page', { pageId, ...(shownVersion ? { version: shownVersion } : {}) })
    if (!res.ok) {
      setDetail(null)
      return setDetailError(res.error.message)
    }
    setDetailError(null)
    setDetail(res.data)
  }, [pageId, shownVersion])

  useEffect(() => {
    void loadSpaces()
  }, [loadSpaces])
  useEffect(() => {
    void loadPages()
  }, [loadPages])
  useEffect(() => {
    void loadDetail()
  }, [loadDetail])
  useEffect(() => {
    setShownVersion(null)
    setEditing(null)
  }, [pageId])

  const tags = [...new Set((pages ?? []).flatMap((p) => p.tags))].sort()
  const refresh = () => {
    void loadPages()
    void loadDetail()
  }

  if (error && !spaces) return <ErrorState title="Could not load the knowledge base" description={error} onRetry={() => void loadSpaces()} />
  if (!spaces) return <LoadingState label="Loading knowledge base" />

  const main = () => {
    if (editing === 'new' || (editing === 'edit' && detail)) {
      return (
        <PageEditor
          key={editing === 'edit' ? `${detail!.page.id}-${detail!.page.row_version}` : 'new'}
          page={editing === 'edit' ? detail!.page : null}
          spaces={spaces}
          candidates={pages ?? []}
          defaultSpaceId={spaceId || spaces[0]?.id || ''}
          onCancel={() => setEditing(null)}
          onSaved={(id) => {
            setEditing(null)
            if (id === pageId) refresh()
            else {
              void loadPages()
              navigate(`/knowledge/${id}`)
            }
          }}
        />
      )
    }
    if (!pageId) return <EmptyState icon={<BookOpen aria-hidden className="h-6 w-6 text-text-faint" />} title="Choose a page" description="Pick a page from the list, search, or create a new draft. Meeting minutes from email appear in the Meetings space as drafts." />
    if (detailError) return <ErrorState title="Page not available" description={detailError} onRetry={() => void loadDetail()} />
    if (!detail) return <LoadingState label="Loading page" />
    return <PageView detail={detail} role={role} userId={userId} onEdit={() => setEditing('edit')} onChanged={refresh} onShowVersion={setShownVersion} />
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Knowledge"
        description="Team pages, decisions and meeting minutes. Drafts go to review before a coordinator or team lead publishes them."
        actions={
          <Button onClick={() => setEditing('new')} disabled={spaces.length === 0}>
            New page
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <aside className="flex flex-col gap-3" aria-label="Spaces and pages">
          <Card>
            <form
              role="search"
              onSubmit={(e) => {
                e.preventDefault()
                setSearch(q.trim())
              }}
              className="flex flex-col gap-2"
            >
              <Input label="Search pages" type="search" value={q} maxLength={200} onChange={(e) => setQ(e.target.value)} placeholder="Words in the title or text" />
              <div className="flex gap-2">
                <Button type="submit" size="sm">
                  Search
                </Button>
                {search ? (
                  <Button size="sm" variant="ghost" onClick={() => { setQ(''); setSearch('') }}>
                    Clear
                  </Button>
                ) : null}
              </div>
            </form>
            <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-1">
              <Select label="Space" value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
                <option value="">All spaces</option>
                {spaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Any status</option>
                {KB_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
              <Select label="Tag" value={tag} onChange={(e) => setTag(e.target.value)}>
                <option value="">Any tag</option>
                {(tag && !tags.includes(tag) ? [tag, ...tags] : tags).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
            {role === 'coordinator' ? <NewSpaceForm onCreated={(id) => { void loadSpaces(); setSpaceId(id) }} /> : null}
          </Card>
          <Card>
            {error ? <p role="alert" className="text-sm text-status-overdue">{error}</p> : null}
            {spaces.length === 0 ? (
              <p className="text-sm text-text-faint">No spaces yet. {role === 'coordinator' ? 'Create one above.' : 'A coordinator creates spaces.'}</p>
            ) : pages === null ? (
              <LoadingState label="Loading pages" rows={2} />
            ) : pages.length === 0 ? (
              <p className="text-sm text-text-faint">{search || status || tag ? 'No pages match these filters.' : 'No pages yet.'}</p>
            ) : (
              <PageTree pages={pages} />
            )}
          </Card>
        </aside>
        <section aria-label="Page" className="min-w-0">
          {main()}
        </section>
      </div>
    </div>
  )
}

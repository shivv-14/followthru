import { useEffect, useState, type FormEvent } from 'react'
import { Button, Card, CardHeader, CardTitle, Textarea } from '../components/ui'
import { supabase } from '../lib/supabase'
import { callApi } from './api'
import { useCloud } from './session'

interface CommentRow {
  id: string
  body: string
  author_profile_id: string | null
  created_at: string
  edited_at: string | null
}

const EDIT_WINDOW_MS = 15 * 60_000

/** Task discussion. @username mentions notify people in this workspace; you can edit or delete your own comment for 15 minutes. */
export function TaskComments({ taskId, taskKey }: { taskId: string; taskKey: string }) {
  const cloud = useCloud()!
  const [comments, setComments] = useState<CommentRow[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [body, setBody] = useState('')
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let stale = false
    void supabase()
      .from('comments')
      .select('id, body, author_profile_id, created_at, edited_at')
      .eq('task_id', taskId)
      .order('created_at')
      .then(async ({ data }) => {
        if (stale) return
        const rows = (data ?? []) as CommentRow[]
        setComments(rows)
        const ids = [...new Set(rows.map((r) => r.author_profile_id).filter((x): x is string => !!x))]
        // Names of authors this account may see; others show as "a teammate"
        const { data: people } = ids.length ? await supabase().from('profiles').select('id, full_name').in('id', ids) : { data: [] }
        if (!stale) setNames(new Map((people ?? []).map((p) => [p.id as string, p.full_name as string])))
      })
    return () => {
      stale = true
    }
  }, [taskId, cloud.version])

  async function post(e: FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    const res = await callApi('comments/add', { taskKey, body })
    setMessage(res.ok ? '' : res.error.message)
    if (res.ok) {
      setBody('')
      cloud.bump()
    }
  }

  async function save() {
    if (!editing) return
    const res = await callApi('comments/edit', { id: editing.id, body: editing.body })
    setMessage(res.ok ? '' : res.error.message)
    setEditing(null)
    cloud.bump()
  }

  async function remove(id: string) {
    const res = await callApi('comments/delete', { id })
    setMessage(res.ok ? '' : res.error.message)
    cloud.bump()
  }

  const mine = (c: CommentRow) => c.author_profile_id === cloud.me?.profile.id && Date.now() - Date.parse(c.created_at) < EDIT_WINDOW_MS

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comments ({comments.length})</CardTitle>
      </CardHeader>
      <ul className="mb-4 flex flex-col gap-3">
        {comments.map((c) => (
          <li key={c.id} className="rounded-2xl border border-surface-border p-3 text-sm">
            <p className="mb-1 text-xs text-text-faint">
              {(c.author_profile_id && names.get(c.author_profile_id)) || (c.author_profile_id === cloud.me?.profile.id ? 'You' : 'A teammate')} · {new Date(c.created_at).toLocaleString()}
              {c.edited_at ? ' · edited' : ''}
            </p>
            {editing?.id === c.id ? (
              <div className="flex flex-col gap-2">
                <Textarea label="Edit comment" value={editing.body} onChange={(e) => setEditing({ id: c.id, body: e.target.value })} />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void save()}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <p className="whitespace-pre-wrap text-text-muted">{c.body}</p>
            )}
            {mine(c) && editing?.id !== c.id ? (
              <div className="mt-2 flex gap-3 text-xs">
                <button type="button" className="text-accent hover:underline" onClick={() => setEditing({ id: c.id, body: c.body })}>
                  Edit
                </button>
                <button type="button" className="text-status-overdue hover:underline" onClick={() => void remove(c.id)}>
                  Delete
                </button>
              </div>
            ) : null}
          </li>
        ))}
        {comments.length === 0 ? <li className="text-sm text-text-muted">No comments yet.</li> : null}
      </ul>
      <form onSubmit={post} className="flex flex-col gap-2">
        <Textarea label="Add a comment" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Type @username to mention someone" />
        {message ? (
          <p role="alert" className="text-sm text-status-overdue">
            {message}
          </p>
        ) : null}
        <Button type="submit" size="sm" disabled={!body.trim()} className="self-start">
          Post comment
        </Button>
      </form>
    </Card>
  )
}

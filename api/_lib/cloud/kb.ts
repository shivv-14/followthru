import type { EmailAnalysis } from '../../../src/automation/schema'
import { ticketIdFor } from '../../../src/automation/plan'
import { buildMinutesPage, MEETINGS_SPACE } from '../../../src/knowledge/minutesPage'
import type { KbStatus } from '../../../src/knowledge/rules'
import { admin, applyOps, uuid, type Op } from './admin'
import { auditOp } from './notify'

export const PAGE_COLUMNS = 'id, org_id, space_id, parent_id, slug, title, body_md, status, tags, owner_profile_id, source, version, row_version, created_at, updated_at'
export const PAGE_LIST_COLUMNS = 'id, space_id, parent_id, slug, title, status, tags, owner_profile_id, source, version, row_version, updated_at'

export interface PageRow {
  id: string
  org_id: string
  space_id: string
  parent_id: string | null
  slug: string
  title: string
  body_md: string
  status: KbStatus
  tags: string[]
  owner_profile_id: string | null
  source: Record<string, unknown> | null
  version: number
  row_version: number
}

/** The version row every save appends; the page and its history always change together. */
export function versionOp(orgId: string, pageId: string, v: { version: number; title: string; bodyMd: string; status: KbStatus; tags: string[]; editedBy: string | null; note?: string }): Op {
  return {
    op: 'insert',
    table: 'kb_page_versions',
    row: { org_id: orgId, page_id: pageId, version: v.version, title: v.title, body_md: v.bodyMd, status: v.status, tags: v.tags, edited_by: v.editedBy, note: v.note?.slice(0, 300) ?? null },
  }
}

/** Finds a space by key, creating it when missing. A concurrent create of the same key is tolerated. */
export async function ensureSpace(orgId: string, key: string, name: string, description: string, actorProfileId: string | null): Promise<string> {
  const find = async () => (await admin().from('kb_spaces').select('id').eq('org_id', orgId).eq('space_key', key).maybeSingle()).data?.id as string | undefined
  const existing = await find()
  if (existing) return existing
  const id = uuid()
  await applyOps([
    { op: 'upsert', table: 'kb_spaces', conflict: ['org_id', 'space_key'], ignore_duplicates: true, row: { id, org_id: orgId, space_key: key, name, description, created_by: actorProfileId } },
    auditOp(orgId, actorProfileId, actorProfileId ? null : 'automation', 'kb.space_create', 'kb_space', key, null, { key, name }),
  ])
  return (await find()) ?? id
}

export interface MinutesEmail {
  id: string
  org_id: string
  gmail_message_id: string
  gmail_thread_id: string
  subject: string | null
  sent_at: string
  from_name: string | null
  from_email: string | null
  to_emails: string[]
  cc_emails: string[]
}

/**
 * Saves meeting minutes from one email as a draft page in the 'meetings' space. Idempotent by the
 * email id: a second call finds the existing page and changes nothing.
 */
export async function saveMinutesPage(e: MinutesEmail, a: EmailAnalysis, createdTaskKeys: Set<string>, actorProfileId: string | null): Promise<{ pageId: string; created: boolean; title: string }> {
  if (!a.minutes) throw new Error('No minutes in this reading')
  const { data: existing } = await admin().from('kb_pages').select('id, title').eq('org_id', e.org_id).eq('source->>kind', 'email').eq('source->>emailId', e.id).maybeSingle()
  if (existing) return { pageId: existing.id as string, created: false, title: existing.title as string }
  const spaceId = await ensureSpace(e.org_id, MEETINGS_SPACE.key, MEETINGS_SPACE.name, MEETINGS_SPACE.description, actorProfileId)
  const page = buildMinutesPage({
    emailId: e.id,
    threadId: e.gmail_thread_id,
    subject: e.subject,
    sentAt: e.sent_at,
    fromName: e.from_name,
    fromEmail: e.from_email,
    toEmails: [...e.to_emails, ...e.cc_emails],
    summary: a.summary,
    minutes: a.minutes,
    items: a.items,
    itemTaskKeys: a.items.map((_, i) => {
      const key = `c_${ticketIdFor(e.gmail_message_id, i)}`
      return createdTaskKeys.has(key) ? key : null
    }),
  })
  const id = uuid()
  await applyOps([
    {
      op: 'insert',
      table: 'kb_pages',
      row: { id, org_id: e.org_id, space_id: spaceId, parent_id: null, slug: page.slug, title: page.title, body_md: page.bodyMd, status: 'draft', tags: page.tags, owner_profile_id: actorProfileId, source: page.source, version: 1, row_version: 1 },
    },
    versionOp(e.org_id, id, { version: 1, title: page.title, bodyMd: page.bodyMd, status: 'draft', tags: page.tags, editedBy: actorProfileId, note: 'Created from meeting minutes email' }),
    auditOp(e.org_id, actorProfileId, 'automation', 'kb.minutes_saved', 'kb_page', id, null, { title: page.title, source: page.source }),
  ])
  return { pageId: id, created: true, title: page.title }
}

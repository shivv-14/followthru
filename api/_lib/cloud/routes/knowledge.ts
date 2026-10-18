import type { ApiRequest } from '../../handlers'
import { canChangeStatus, canEditPage, canReadPage, isKbStatus, KB_LIMITS, normalizeTags, slugify, SPACE_KEY_RE, type KbStatus } from '../../../../src/knowledge/rules'
import { admin, applyOps, uuid, type Op } from '../admin'
import { requireRole, requireUser, type Ctx } from '../context'
import { bad, bodyOf, conflict, forbidden, json, notFound, rateLimit, str } from '../http'
import { PAGE_COLUMNS, PAGE_LIST_COLUMNS, versionOp, type PageRow } from '../kb'
import { auditOp } from '../notify'

// Knowledge base. Pages are markdown text, stored and returned as text; the browser renders them
// with its own escaping renderer. Every save appends a version row in the same transaction, and
// updates need the row version the editor started from, so a save never overwrites silently.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function idOf(b: Record<string, unknown>, key: string, optional = false): string {
  const v = str(b, key, { max: 64, optional })
  if (v && !UUID_RE.test(v)) throw bad(`${key} is not a valid id`)
  return v
}

function bodyText(b: Record<string, unknown>): string {
  const v = b.bodyMd ?? ''
  if (typeof v !== 'string') throw bad('bodyMd must be text')
  if (v.length > KB_LIMITS.body) throw bad(`The page is too long (max ${KB_LIMITS.body} characters)`)
  return v.replace(/\r\n?/g, '\n')
}

function expectedVersion(b: Record<string, unknown>): number {
  const n = Number(b.expectedRowVersion)
  if (!Number.isInteger(n) || n < 1) throw bad('expectedRowVersion is required: reload the page and try again')
  return n
}

const access = (p: PageRow) => ({ status: p.status, ownerProfileId: p.owner_profile_id })

async function loadPage(ctx: Ctx, pageId: string): Promise<PageRow> {
  const { data } = await admin().from('kb_pages').select(PAGE_COLUMNS).eq('org_id', ctx.orgId).eq('id', pageId).maybeSingle<PageRow>()
  // A page you may not read looks exactly like a page that does not exist
  if (!data || !canReadPage(access(data), ctx.role, ctx.userId)) throw notFound('Page not found')
  return data
}

function staleCheck(p: PageRow, expected: number): void {
  if (p.row_version !== expected) {
    throw conflict('This page was changed by someone else since you opened it. Your text is kept in the editor; reload to see their version before saving.', { currentRowVersion: p.row_version, currentVersion: p.version })
  }
}

/** The page row update plus its version row, guarded by the row version the editor started from. */
function bumpOps(ctx: Ctx, p: PageRow, expected: number, set: Partial<{ title: string; body_md: string; tags: string[]; parent_id: string | null; status: KbStatus }>, note: string): Op[] {
  const next = { title: set.title ?? p.title, body_md: set.body_md ?? p.body_md, tags: set.tags ?? p.tags, status: set.status ?? p.status }
  return [
    { op: 'update', table: 'kb_pages', match: { id: p.id, org_id: ctx.orgId, row_version: expected }, set: { ...set, version: p.version + 1, row_version: p.row_version + 1 }, require_rows: true },
    versionOp(ctx.orgId, p.id, { version: p.version + 1, title: next.title, bodyMd: next.body_md, status: next.status, tags: next.tags, editedBy: ctx.userId, note }),
  ]
}

/** A parent must be another page of the same space, and never one of the page's own descendants. */
async function checkParent(ctx: Ctx, spaceId: string, parentId: string | null, pageId: string | null): Promise<void> {
  if (!parentId) return
  if (parentId === pageId) throw bad('A page cannot be its own parent')
  const { data: tree } = await admin().from('kb_pages').select('id, parent_id').eq('org_id', ctx.orgId).eq('space_id', spaceId).limit(5000)
  const parentOf = new Map((tree ?? []).map((t) => [t.id as string, (t.parent_id as string | null) ?? null]))
  if (!parentOf.has(parentId)) throw bad('Choose a parent page from the same space')
  for (let at: string | null = parentId, guard = 0; at && guard < 5000; at = parentOf.get(at) ?? null, guard++) {
    if (at === pageId) throw bad('A page cannot move under one of its own child pages')
  }
}

export async function listSpaces(req: ApiRequest) {
  const ctx = await requireUser(req)
  const { data } = await admin().from('kb_spaces').select('id, space_key, name, description, created_at').eq('org_id', ctx.orgId).order('name').limit(200)
  return json(200, { spaces: data ?? [] })
}

/** Creates a space (key fixed once created) or renames one. Coordinators only. */
export async function saveSpace(req: ApiRequest) {
  const ctx = await requireUser(req)
  requireRole(ctx, 'coordinator')
  const b = bodyOf(req)
  const spaceId = idOf(b, 'spaceId', true)
  const name = str(b, 'name', { max: KB_LIMITS.spaceName })
  const description = str(b, 'description', { max: KB_LIMITS.spaceDescription, optional: true }) || null
  if (spaceId) {
    const { data: before } = await admin().from('kb_spaces').select('id, space_key, name, description').eq('org_id', ctx.orgId).eq('id', spaceId).maybeSingle()
    if (!before) throw notFound('Space not found')
    await applyOps([
      { op: 'update', table: 'kb_spaces', match: { id: spaceId, org_id: ctx.orgId }, set: { name, description }, require_rows: true },
      auditOp(ctx.orgId, ctx.userId, ctx.person.id, 'kb.space_update', 'kb_space', before.space_key as string, { name: before.name, description: before.description }, { name, description }),
    ])
    return json(200, { ok: true, spaceId, message: 'Space saved' })
  }
  const key = str(b, 'key', { max: 40 }).toLowerCase()
  if (!SPACE_KEY_RE.test(key)) throw bad('The space key uses lowercase letters, digits and hyphens (up to 40)')
  const id = uuid()
  await applyOps([
    { op: 'insert', table: 'kb_spaces', row: { id, org_id: ctx.orgId, space_key: key, name, description, created_by: ctx.userId } },
    auditOp(ctx.orgId, ctx.userId, ctx.person.id, 'kb.space_create', 'kb_space', key, null, { key, name, description }),
  ])
  return json(201, { ok: true, spaceId: id, message: `Space "${name}" created` })
}

/** Pages the caller may read, filtered by space, status, tag and a full-text search. Bodies are not included. */
export async function listPages(req: ApiRequest) {
  const ctx = await requireUser(req)
  const b = bodyOf(req)
  const q = str(b, 'q', { max: 200, optional: true })
  const spaceId = idOf(b, 'spaceId', true)
  const status = str(b, 'status', { max: 20, optional: true })
  const tag = str(b, 'tag', { max: KB_LIMITS.tag, optional: true }).toLowerCase()
  if (status && !isKbStatus(status)) throw bad('Unknown status')
  let query = admin().from('kb_pages').select(PAGE_LIST_COLUMNS).eq('org_id', ctx.orgId)
  if (spaceId) query = query.eq('space_id', spaceId)
  if (status) query = query.eq('status', status)
  if (tag) query = query.contains('tags', [tag])
  if (q) query = query.textSearch('search_tsv', q, { type: 'websearch', config: 'simple' })
  if (ctx.role === 'member') query = query.or(`status.eq.published,owner_profile_id.eq.${ctx.userId}`)
  const { data, error } = await query.order('title').limit(500)
  if (error) throw bad('That search could not be run. Try simpler words.')
  return json(200, { pages: data ?? [] })
}

/** One page with its version list; with `version`, also that version's text. */
export async function getPage(req: ApiRequest) {
  const ctx = await requireUser(req)
  const b = bodyOf(req)
  const page = await loadPage(ctx, idOf(b, 'pageId'))
  const fullHistory = ctx.role !== 'member' || page.owner_profile_id === ctx.userId
  let versions = admin().from('kb_page_versions').select('id, version, title, status, note, created_at, profiles!kb_page_versions_edited_by_fkey(full_name)').eq('page_id', page.id).order('version', { ascending: false }).limit(200)
  if (!fullHistory) versions = versions.eq('status', 'published')
  const [{ data: list }, { data: space }, { data: owner }] = await Promise.all([
    versions,
    admin().from('kb_spaces').select('id, space_key, name').eq('id', page.space_id).maybeSingle(),
    page.owner_profile_id ? admin().from('profiles').select('full_name').eq('id', page.owner_profile_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  let shown = null
  if (b.version !== undefined && b.version !== null) {
    const v = Number(b.version)
    if (!Number.isInteger(v) || v < 1) throw bad('Unknown version')
    const { data } = await admin().from('kb_page_versions').select('version, title, body_md, status, tags, note, created_at').eq('page_id', page.id).eq('version', v).maybeSingle()
    if (!data || (!fullHistory && data.status !== 'published')) throw notFound('Version not found')
    shown = data
  }
  return json(200, {
    page,
    space,
    ownerName: (owner as { full_name?: string } | null)?.full_name ?? null,
    versions: (list ?? []).map((v) => ({ version: v.version, title: v.title, status: v.status, note: v.note, createdAt: v.created_at, editedBy: (v.profiles as unknown as { full_name?: string } | null)?.full_name ?? null })),
    shownVersion: shown,
  })
}

/** Creates a draft, or saves a new version of a page the caller may edit. */
export async function savePage(req: ApiRequest) {
  const ctx = await requireUser(req)
  rateLimit(`kb-save:${ctx.userId}`, 120, 60_000)
  const b = bodyOf(req)
  const pageId = idOf(b, 'pageId', true)
  const title = str(b, 'title', { max: KB_LIMITS.title }).replace(/\s+/g, ' ')
  const bodyMd = bodyText(b)
  const tags = normalizeTags(b.tags)
  if (!tags.ok) throw bad(tags.error)
  const note = str(b, 'note', { max: 300, optional: true }) || undefined
  const parentGiven = 'parentId' in b
  const parentId = idOf(b, 'parentId', true) || null

  if (!pageId) {
    const spaceId = idOf(b, 'spaceId')
    const { data: space } = await admin().from('kb_spaces').select('id').eq('org_id', ctx.orgId).eq('id', spaceId).maybeSingle()
    if (!space) throw notFound('Space not found')
    await checkParent(ctx, spaceId, parentId, null)
    const base = slugify(title)
    const { data: taken } = await admin().from('kb_pages').select('slug').eq('org_id', ctx.orgId).eq('space_id', spaceId).like('slug', `${base}%`).limit(1000)
    const used = new Set((taken ?? []).map((t) => t.slug as string))
    let slug = base
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`
    const id = uuid()
    await applyOps([
      { op: 'insert', table: 'kb_pages', row: { id, org_id: ctx.orgId, space_id: spaceId, parent_id: parentId, slug, title, body_md: bodyMd, status: 'draft', tags: tags.tags, owner_profile_id: ctx.userId, source: null, version: 1, row_version: 1 } },
      versionOp(ctx.orgId, id, { version: 1, title, bodyMd, status: 'draft', tags: tags.tags, editedBy: ctx.userId, note: note ?? 'Created' }),
      auditOp(ctx.orgId, ctx.userId, ctx.person.id, 'kb.page_create', 'kb_page', id, null, { title, slug, spaceId, parentId, tags: tags.tags, length: bodyMd.length }),
    ])
    return json(201, { ok: true, pageId: id, version: 1, rowVersion: 1, message: 'Draft created' })
  }

  const expected = expectedVersion(b)
  const p = await loadPage(ctx, pageId)
  if (!canEditPage(access(p), ctx.role, ctx.userId)) throw forbidden(p.status === 'archived' ? 'Archived pages are read-only. A coordinator can move it back to draft.' : 'You can edit only your own drafts')
  staleCheck(p, expected)
  const newParent = parentGiven ? parentId : p.parent_id
  if (parentGiven) await checkParent(ctx, p.space_id, newParent, p.id)
  const same = title === p.title && bodyMd === p.body_md && tags.tags.join(',') === p.tags.join(',') && newParent === p.parent_id
  if (same) return json(200, { ok: true, pageId: p.id, version: p.version, rowVersion: p.row_version, message: 'No changes to save' })
  await applyOps([
    ...bumpOps(ctx, p, expected, { title, body_md: bodyMd, tags: tags.tags, parent_id: newParent }, note ?? 'Edited'),
    auditOp(ctx.orgId, ctx.userId, ctx.person.id, 'kb.page_save', 'kb_page', p.id, { title: p.title, version: p.version, tags: p.tags, parentId: p.parent_id, length: p.body_md.length }, { title, version: p.version + 1, tags: tags.tags, parentId: newParent, length: bodyMd.length }),
  ])
  return json(200, { ok: true, pageId: p.id, version: p.version + 1, rowVersion: p.row_version + 1, message: `Saved as version ${p.version + 1}` })
}

/** Moves a page along draft -> review -> published -> archived. */
export async function setPageStatus(req: ApiRequest) {
  const ctx = await requireUser(req)
  const b = bodyOf(req)
  const to = str(b, 'status', { max: 20 })
  if (!isKbStatus(to)) throw bad('Unknown status')
  const expected = expectedVersion(b)
  const p = await loadPage(ctx, idOf(b, 'pageId'))
  if (!canChangeStatus(access(p), to, ctx.role, ctx.userId)) {
    throw forbidden(to === 'published' || to === 'archived' ? 'Only a coordinator or team lead can publish or archive, and only from the right step' : `A ${p.status} page cannot move to ${to} by you`)
  }
  staleCheck(p, expected)
  await applyOps([
    ...bumpOps(ctx, p, expected, { status: to }, `Status ${p.status} to ${to}`),
    auditOp(ctx.orgId, ctx.userId, ctx.person.id, 'kb.page_status', 'kb_page', p.id, { status: p.status, version: p.version }, { status: to, version: p.version + 1 }),
  ])
  return json(200, { ok: true, version: p.version + 1, rowVersion: p.row_version + 1, message: `Page moved to ${to}` })
}

/** Restores an earlier version's title, text and tags as a new version. History is never rewritten. */
export async function restorePage(req: ApiRequest) {
  const ctx = await requireUser(req)
  const b = bodyOf(req)
  const v = Number(b.version)
  if (!Number.isInteger(v) || v < 1) throw bad('Choose a version to restore')
  const expected = expectedVersion(b)
  const p = await loadPage(ctx, idOf(b, 'pageId'))
  if (!canEditPage(access(p), ctx.role, ctx.userId)) throw forbidden('You cannot edit this page')
  staleCheck(p, expected)
  if (v === p.version) throw bad('That is already the current version')
  const { data: old } = await admin().from('kb_page_versions').select('version, title, body_md, tags').eq('page_id', p.id).eq('version', v).maybeSingle()
  if (!old) throw notFound('Version not found')
  await applyOps([
    ...bumpOps(ctx, p, expected, { title: old.title as string, body_md: old.body_md as string, tags: (old.tags as string[]) ?? [] }, `Restored version ${v}`),
    auditOp(ctx.orgId, ctx.userId, ctx.person.id, 'kb.page_restore', 'kb_page', p.id, { version: p.version, title: p.title }, { version: p.version + 1, restoredFrom: v, title: old.title }),
  ])
  return json(200, { ok: true, version: p.version + 1, rowVersion: p.row_version + 1, message: `Version ${v} restored as version ${p.version + 1}` })
}

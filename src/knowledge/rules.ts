// Knowledge base rules shared by the server routes and the page, so the buttons a person sees
// match exactly what the server will accept.

export const KB_STATUSES = ['draft', 'review', 'published', 'archived'] as const
export type KbStatus = (typeof KB_STATUSES)[number]
export type KbRole = 'coordinator' | 'team_lead' | 'member'

export const KB_LIMITS = { title: 200, body: 100_000, tags: 20, tag: 30, spaceName: 120, spaceDescription: 1000 } as const

export const SPACE_KEY_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
const TAG_RE = /^[a-z0-9][a-z0-9-]{0,29}$/

export const isKbStatus = (v: unknown): v is KbStatus => typeof v === 'string' && (KB_STATUSES as readonly string[]).includes(v)
const isReviewer = (role: KbRole) => role === 'coordinator' || role === 'team_lead'

/** URL-safe slug from a title: lowercase letters, digits and single hyphens. */
export function slugify(text: string, max = 80): string {
  const s = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')
  return s || 'page'
}

/** Cleans a tag list: lowercase, de-duplicated, valid characters only. Returns an error message for bad input. */
export function normalizeTags(value: unknown): { ok: true; tags: string[] } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, tags: [] }
  const list = typeof value === 'string' ? value.split(',') : value
  if (!Array.isArray(list)) return { ok: false, error: 'Tags must be a list' }
  const tags: string[] = []
  for (const raw of list) {
    if (typeof raw !== 'string') return { ok: false, error: 'Each tag must be text' }
    const t = raw.trim().toLowerCase().replace(/\s+/g, '-')
    if (!t) continue
    if (!TAG_RE.test(t)) return { ok: false, error: `"${raw.slice(0, 40)}" is not a valid tag (letters, digits and hyphens, up to ${KB_LIMITS.tag})` }
    if (!tags.includes(t)) tags.push(t)
  }
  if (tags.length > KB_LIMITS.tags) return { ok: false, error: `Use at most ${KB_LIMITS.tags} tags` }
  return { ok: true, tags }
}

export interface PageAccess {
  status: KbStatus
  ownerProfileId: string | null
}

/** Who may read a page: published for everyone, everything for reviewers, own pages for their owner. */
export function canReadPage(page: PageAccess, role: KbRole, userId: string): boolean {
  return page.status === 'published' || isReviewer(role) || page.ownerProfileId === userId
}

/** Coordinators and team leads edit any page that is not archived; members only their own drafts. */
export function canEditPage(page: PageAccess, role: KbRole, userId: string): boolean {
  if (page.status === 'archived') return false
  if (isReviewer(role)) return true
  return page.ownerProfileId === userId && page.status === 'draft'
}

/**
 * Status moves: draft -> review -> published -> archived. The owner may send a draft to review or
 * pull it back; publishing, archiving and reviving an archived page need a coordinator or team lead.
 */
export function canChangeStatus(page: PageAccess, to: KbStatus, role: KbRole, userId: string): boolean {
  const owner = page.ownerProfileId === userId
  const from = page.status
  if (from === to) return false
  if (from === 'draft' && to === 'review') return owner || isReviewer(role)
  if (from === 'review' && to === 'draft') return owner || isReviewer(role)
  if (from === 'review' && to === 'published') return isReviewer(role)
  if (from === 'published' && (to === 'archived' || to === 'draft')) return isReviewer(role)
  if (from === 'archived' && to === 'draft') return isReviewer(role)
  return false
}

/** The status moves a person can make from the current status, in display order. */
export function nextStatuses(page: PageAccess, role: KbRole, userId: string): KbStatus[] {
  return KB_STATUSES.filter((to) => canChangeStatus(page, to, role, userId))
}

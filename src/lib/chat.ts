// Team chat: one conversation per team plus one for the whole workspace.
// Chat lines are ordinary messages, so the engine reads them like any import.

export const ALL_TEAMS = 'all'
export const MAX_CHAT_TEXT = 2000

export function chatThreadId(teamId: string): string {
  return `team-${teamId}`
}

export function chatTitle(teamId: string): string {
  return teamId === ALL_TEAMS ? 'Whole workspace' : `Team ${teamId}`
}

/** Coordinators use every chat; others use the workspace chat, their own team and teams they lead. */
export function canUseChat(role: string, ownTeam: string | undefined, ledTeams: string[], teamId: string): boolean {
  if (role === 'coordinator' || teamId === ALL_TEAMS) return true
  return teamId === ownTeam || ledTeams.includes(teamId)
}

/** The team of a chat thread id, or null when the thread is not a team chat. */
export function chatTeamOf(threadId: string): string | null {
  return threadId.startsWith('team-') ? threadId.slice(5) : null
}

// ---------------------------------------------------------------------------
// Reactions, threads, search and mentions. Reactions are never engine input.
// ---------------------------------------------------------------------------

export const REACTIONS = ['👍', '✅', '👀', '🎉'] as const
export type Reaction = (typeof REACTIONS)[number]
/** Emoji to the ids of the people who reacted with it, sorted and unique. Empty lists are dropped. */
export type Reactions = Partial<Record<Reaction, string[]>>

export function isReaction(v: unknown): v is Reaction {
  return typeof v === 'string' && (REACTIONS as readonly string[]).includes(v)
}

/** Cleans stored reactions: unknown emoji, non-text ids, duplicates and empty lists are dropped. */
export function normaliseReactions(value: unknown): Reactions {
  const out: Reactions = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const emoji of REACTIONS) {
    const ids = (value as Record<string, unknown>)[emoji]
    if (!Array.isArray(ids)) continue
    const clean = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 120))].sort()
    if (clean.length > 0) out[emoji] = clean
  }
  return out
}

/** Reactions kept in a message's raw JSON (cloud) or on the message object (demo). */
export function reactionsOf(raw: unknown): Reactions {
  return raw && typeof raw === 'object' ? normaliseReactions((raw as { reactions?: unknown }).reactions) : {}
}

/**
 * One person's reaction, merged into the existing ones. `on` true adds, false
 * removes, and leaving it out toggles. Adding or removing twice changes nothing,
 * so retries are safe; other people's reactions are always kept.
 */
export function applyReaction(current: unknown, emoji: Reaction, personId: string, on?: boolean): Reactions {
  const next = normaliseReactions(current)
  const ids = next[emoji] ?? []
  const want = on ?? !ids.includes(personId)
  const updated = want ? [...new Set([...ids, personId])].sort() : ids.filter((id) => id !== personId)
  if (updated.length > 0) next[emoji] = updated
  else delete next[emoji]
  return next
}

export interface ThreadLine {
  id: string
  replyToId?: string
}

/** The top message of the thread a line belongs to (itself when it is not a reply). Unknown parents end the walk. */
export function threadRoot<T extends ThreadLine>(line: T, byId: Map<string, T>): string {
  let cur = line
  const seen = new Set<string>([cur.id])
  while (cur.replyToId && byId.has(cur.replyToId) && !seen.has(cur.replyToId)) {
    cur = byId.get(cur.replyToId)!
    seen.add(cur.id)
  }
  return cur.id
}

/** Top-level lines in order, and the replies of each thread in order. */
export function groupThreads<T extends ThreadLine>(lines: T[]): { roots: T[]; replies: Map<string, T[]> } {
  const byId = new Map(lines.map((l) => [l.id, l]))
  const roots: T[] = []
  const replies = new Map<string, T[]>()
  for (const l of lines) {
    const root = threadRoot(l, byId)
    if (root === l.id) roots.push(l)
    else replies.set(root, [...(replies.get(root) ?? []), l])
  }
  return { roots, replies }
}

/** Case-insensitive match on the text or the author's name. An empty query matches everything. */
export function matchesSearch(line: { text: string; authorName?: string }, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return line.text.toLowerCase().includes(q) || (line.authorName ?? '').toLowerCase().includes(q)
}

export const MAX_SEARCH = 100

/** Escapes LIKE wildcards so a search for "50%" finds that text literally. */
export function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/** The "@partial" being typed right before the caret, if any. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|\s)@([^\s@]{0,30})$/.exec(text.slice(0, caret))
  return m ? { start: caret - m[2].length - 1, query: m[2] } : null
}

/** People whose full name follows an @ in the text, for example "@Lena Ortiz". */
export function mentionedIds(text: string, people: { id: string; name: string }[]): string[] {
  const lower = text.toLowerCase()
  return people
    .filter((p) => {
      const tag = `@${p.name.toLowerCase()}`
      for (let i = lower.indexOf(tag); i >= 0; i = lower.indexOf(tag, i + 1)) {
        const after = lower[i + tag.length]
        if (after === undefined || !/[\p{L}\p{N}]/u.test(after)) return true
      }
      return false
    })
    .map((p) => p.id)
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ALL_TEAMS, MAX_CHAT_TEXT, MAX_SEARCH, canUseChat, chatTeamOf, chatThreadId, chatTitle, matchesSearch, reactionsOf, type Reaction, type Reactions } from '../lib/chat'
import { callApi } from '../cloud/api'
import { useCloudData } from '../cloud/CloudEngineProvider'
import { useCloud } from '../cloud/session'
import type { ActionResult } from './actions'
import { useEngine } from './EngineProvider'
import * as repo from './repo'

export interface ChatTeam {
  id: string
  title: string
}

export interface ChatLine {
  id: string
  authorId: string
  authorName: string
  text: string
  sentAt: string
  replyToId?: string
  reactions?: Reactions
}

export interface ChatSearchHit extends ChatLine {
  teamId: string
  chatTitle: string
}

const POLL_MS = 5000

/** Team chats the current person may open. */
export function useChatTeams(): ChatTeam[] {
  const state = useEngine()
  const cloudData = useCloudData()
  const [cloudTeams, setCloudTeams] = useState<ChatTeam[] | null>(null)
  useEffect(() => {
    if (!cloudData) return
    let live = true
    void callApi<{ teams: ChatTeam[] }>('chat/teams').then((res) => {
      if (live && res.ok) setCloudTeams(res.data.teams)
    })
    return () => {
      live = false
    }
  }, [cloudData])
  return useMemo(() => {
    if (cloudData) return cloudTeams ?? []
    const user = state.user
    const teams = [...new Set([...state.people.values()].map((p) => p.teamId).filter((t): t is string => !!t))].sort()
    return [ALL_TEAMS, ...teams].filter((t) => user && canUseChat(user.role ?? 'member', user.teamId, [], t)).map((id) => ({ id, title: chatTitle(id) }))
  }, [cloudData, cloudTeams, state.people, state.user])
}

/** Lines of one team chat and a way to post. Every line is also engine input. */
export function useTeamChat(teamId: string | null) {
  const state = useEngine()
  const cloudData = useCloudData()
  const session = useCloud()
  const [cloudLines, setCloudLines] = useState<ChatLine[]>([])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!cloudData || !teamId) return
    const res = await callApi<{ messages: ChatLine[] }>('chat/messages', { teamId })
    if (res.ok) {
      setCloudLines(res.data.messages)
      setError('')
    } else setError(res.error.message)
  }, [cloudData, teamId])

  useEffect(() => {
    setCloudLines([])
    if (!cloudData || !teamId) return
    void load()
    const t = window.setInterval(() => void load(), POLL_MS)
    return () => window.clearInterval(t)
  }, [cloudData, teamId, load])

  const localLines = useMemo<ChatLine[]>(() => {
    if (cloudData || !teamId || !state.dataset) return []
    const thread = chatThreadId(teamId)
    return state.dataset.data.messages
      .filter((m) => m.threadId === thread)
      .map((m) => ({ id: m.id, authorId: m.authorId, authorName: state.people.get(m.authorId)?.name ?? m.authorId, text: m.text, sentAt: m.sentAt, replyToId: m.replyToId, reactions: reactionsOf(m) }))
  }, [cloudData, teamId, state.dataset, state.people])

  const post = useCallback(
    async (text: string, replyToId?: string): Promise<ActionResult> => {
      const body = text.trim()
      if (!teamId) return { ok: false, message: 'Choose a team chat' }
      if (!body) return { ok: false, message: 'Write a message first' }
      if (body.length > MAX_CHAT_TEXT) return { ok: false, message: `Keep messages under ${MAX_CHAT_TEXT} characters` }
      if (cloudData) {
        const res = await callApi<{ message: string }>('chat/post', { teamId, text: body, replyToId })
        if (!res.ok) return { ok: false, message: res.error.message }
        await load()
        cloudData.reload()
        void session?.refreshMe?.()
        return { ok: true, message: res.data.message }
      }
      const user = state.user
      if (!user) return { ok: false, message: 'Choose a profile first' }
      if (!state.dataset) return { ok: false, message: 'Load data first' }
      await repo.appendMessage(
        user.id,
        { id: repo.newId('chat'), threadId: chatThreadId(teamId), authorId: user.id, sentAt: repo.nowIso(), text: body, ...(replyToId ? { replyToId } : {}) },
        chatTitle(teamId),
      )
      return { ok: true, message: 'Posted. Commitments were re-checked.' }
    },
    [teamId, cloudData, load, session, state.user, state.dataset],
  )

  /** Adds or removes the current person's reaction. `on` is the wanted end state, so a retry changes nothing. */
  const react = useCallback(
    async (messageId: string, emoji: Reaction, on: boolean): Promise<ActionResult> => {
      if (!teamId) return { ok: false, message: 'Choose a team chat' }
      if (cloudData) {
        const res = await callApi<{ message: string; reactions: Reactions }>('chat/react', { teamId, messageId, emoji, on })
        if (!res.ok) return { ok: false, message: res.error.message }
        setCloudLines((cur) => cur.map((l) => (l.id === messageId ? { ...l, reactions: res.data.reactions } : l)))
        return { ok: true, message: res.data.message }
      }
      const user = state.user
      if (!user) return { ok: false, message: 'Choose a profile first' }
      try {
        await repo.reactToMessage(user.id, messageId, emoji, on)
        return { ok: true, message: on ? 'Reaction added' : 'Reaction removed' }
      } catch (e) {
        return { ok: false, message: (e as Error).message }
      }
    },
    [teamId, cloudData, state.user],
  )

  return { lines: cloudData ? cloudLines : localLines, post, react, error, me: state.user?.id ?? null }
}

/** Searches every chat the person may open. Cloud mode asks the server, which applies the same chat permissions. */
export function useChatSearch(teams: ChatTeam[]) {
  const state = useEngine()
  const cloudData = useCloudData()
  return useCallback(
    async (query: string): Promise<{ ok: boolean; message: string; results: ChatSearchHit[] }> => {
      const q = query.trim()
      if (q.length < 2) return { ok: false, message: 'Type at least two characters to search', results: [] }
      if (cloudData) {
        const res = await callApi<{ results: ChatSearchHit[] }>('chat/search', { query: q })
        return res.ok ? { ok: true, message: `${res.data.results.length} found`, results: res.data.results } : { ok: false, message: res.error.message, results: [] }
      }
      const allowed = new Set(teams.map((t) => t.id))
      const results = (state.dataset?.data.messages ?? [])
        .map((m) => ({ m, teamId: chatTeamOf(m.threadId) }))
        .filter((x): x is { m: (typeof x)['m']; teamId: string } => !!x.teamId && allowed.has(x.teamId))
        .map(({ m, teamId }) => ({ id: m.id, authorId: m.authorId, authorName: state.people.get(m.authorId)?.name ?? m.authorId, text: m.text, sentAt: m.sentAt, replyToId: m.replyToId, teamId, chatTitle: chatTitle(teamId) }))
        .filter((l) => matchesSearch(l, q))
        .reverse()
        .slice(0, MAX_SEARCH)
      return { ok: true, message: `${results.length} found`, results }
    },
    [cloudData, teams, state.dataset, state.people],
  )
}

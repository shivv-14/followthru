import { useCallback, useEffect, useMemo, useState } from 'react'
import { ALL_TEAMS, MAX_CHAT_TEXT, canUseChat, chatThreadId, chatTitle } from '../lib/chat'
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
      .map((m) => ({ id: m.id, authorId: m.authorId, authorName: state.people.get(m.authorId)?.name ?? m.authorId, text: m.text, sentAt: m.sentAt, replyToId: m.replyToId }))
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

  return { lines: cloudData ? cloudLines : localLines, post, error, me: state.user?.id ?? null }
}

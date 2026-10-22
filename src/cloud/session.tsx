import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Person } from '../engine/types'
import { cloudEnabled, supabase } from '../lib/supabase'
import { SESSION_EXPIRED_EVENT, callApi, type ApiResult } from './api'

export type AccountRole = 'coordinator' | 'team_lead' | 'member'

export interface Me {
  profile: { id: string; fullName: string; username: string; email: string | null; role: AccountRole; timezone: string; personId: string; mustChangePassword: boolean }
  /** Null for a team member who has not joined a workspace yet */
  org: { id: string; name: string } | null
  person: Person
  ledTeams: string[]
  /** The workspace's data clock (reference time), when the evaluation clock follows the data */
  dataClock: string | null
}

export interface MemberSignupInput {
  fullName: string
  username: string
  email: string
  password: string
  timezone: string
}

export interface SignupInput {
  description?: string
  orgName: string
  fullName: string
  username: string
  email: string
  password: string
  timezone: string
  role: 'coordinator' | 'team_lead'
}

export interface CloudSession {
  status: 'loading' | 'signed_out' | 'signed_in'
  me: Me | null
  /** Bumped by live updates; data hooks refetch when it changes */
  version: number
  bump: () => void
  signIn: (identifier: string, password: string) => Promise<ApiResult<{ mustChangePassword: boolean; role: AccountRole }>>
  signUp: (input: SignupInput) => Promise<ApiResult<unknown>>
  signUpMember: (input: MemberSignupInput) => Promise<ApiResult<unknown>>
  signOut: () => Promise<void>
  changePassword: (password: string) => Promise<ApiResult<unknown>>
  refreshMe: () => Promise<void>
}

const SessionContext = createContext<CloudSession | null>(null)

/** Cloud session, or null in the browser-only demo mode. */
export function useCloud(): CloudSession | null {
  return useContext(SessionContext)
}

type Tokens = { access_token: string; refresh_token: string }

export function CloudSessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<CloudSession['status']>('loading')
  const [me, setMe] = useState<Me | null>(null)
  const [version, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((v) => v + 1), [])

  const refreshMe = useCallback(async () => {
    const { data } = await supabase().auth.getSession()
    if (!data.session) {
      setMe(null)
      setStatus('signed_out')
      return
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await callApi<Me>('auth/me', {}, data.session.access_token)
      if (res.ok) {
        setMe(res.data)
        setStatus('signed_in')
        return
      }
      if (res.status === 401 || res.status === 403) break
      // A network blip or a busy server is not a reason to sign someone out: wait and try again
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
    }
    // Disabled, deleted or expired: drop the local session
    await supabase().auth.signOut({ scope: 'local' })
    setMe(null)
    setStatus('signed_out')
  }, [])

  useEffect(() => {
    void refreshMe()
    const { data: sub } = supabase().auth.onAuthStateChange((event) => {
      // A password-reset link signs the user in from the URL; load their account then
      if (event === 'PASSWORD_RECOVERY') void refreshMe()
      if (event === 'SIGNED_OUT') {
        setMe(null)
        setStatus('signed_out')
      }
    })
    const expired = () => void supabase().auth.signOut({ scope: 'local' })
    window.addEventListener(SESSION_EXPIRED_EVENT, expired)
    return () => {
      sub.subscription.unsubscribe()
      window.removeEventListener(SESSION_EXPIRED_EVENT, expired)
    }
  }, [refreshMe])

  const adopt = useCallback(
    async (tokens: Tokens | null | undefined) => {
      if (!tokens) return
      await supabase().auth.setSession(tokens)
      await refreshMe()
    },
    [refreshMe],
  )

  const value = useMemo<CloudSession>(
    () => ({
      status,
      me,
      version,
      bump,
      refreshMe,
      async signIn(identifier, password) {
        const res = await callApi<{ session: Tokens; mustChangePassword: boolean; role: AccountRole }>('auth/login', { identifier, password })
        if (res.ok) {
          await adopt(res.data.session)
          // Reviewers bring the engine up to date as they arrive
          if (res.data.role !== 'member' && !res.data.mustChangePassword) void callApi('engine/run', { trigger: 'login' })
        }
        return res
      },
      async signUp(input) {
        const res = await callApi<{ session: Tokens | null }>('auth/signup', input)
        if (res.ok) await adopt(res.data.session)
        return res
      },
      async signUpMember(input) {
        const res = await callApi<{ session: Tokens | null }>('auth/signup-member', input)
        if (res.ok) await adopt(res.data.session)
        return res
      },
      async signOut() {
        await callApi('auth/logout')
        await supabase().auth.signOut({ scope: 'local' })
        setMe(null)
        setStatus('signed_out')
      },
      async changePassword(password) {
        const res = await callApi<{ session: Tokens | null }>('auth/change-password', { password })
        if (res.ok) {
          if (res.data.session) await adopt(res.data.session)
          else await refreshMe()
        }
        return res
      },
    }),
    [status, me, version, bump, refreshMe, adopt],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

/** Wraps the app in the cloud session when Supabase is configured; otherwise renders the demo mode as before. */
export function MaybeCloud({ children }: { children: ReactNode }) {
  return cloudEnabled ? <CloudSessionProvider>{children}</CloudSessionProvider> : <>{children}</>
}

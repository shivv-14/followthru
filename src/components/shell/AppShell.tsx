import { Suspense, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { BottomTabBar } from './BottomTabBar'
import { MobileNavSheet } from './MobileNavSheet'
import { LoadingState, SkipLink } from '../ui'
import { OfflineBanner } from './OfflineBanner'
import { useEngine } from '../../store'
import { useCloud } from '../../cloud/session'
import { useCloudData } from '../../cloud/CloudEngineProvider'

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const { ready, dataset, user, result } = useEngine()
  const location = useLocation()
  const cloud = useCloud()
  const cloudData = useCloudData()

  if (cloud) {
    if (cloud.status === 'signed_out') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
    if (cloud.me?.profile.mustChangePassword) return <Navigate to="/change-password" replace />
    // A team member who has not joined a workspace yet picks one first
    if (cloud.me && !cloud.me.org) return <Navigate to="/workspaces" replace />
  }
  if (!ready || (cloud && cloud.status === 'loading')) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <LoadingState label="Loading local data" />
      </div>
    )
  }
  // No data or nobody signed in: the login page handles both and returns here afterwards
  if (!cloud && (!dataset || !user)) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />

  return (
    <div className="flex min-h-dvh">
      <div className="app-backdrop" aria-hidden />
      <SkipLink />
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineBanner />
        <TopBar onOpenMobileNav={() => setMobileNavOpen(true)} />
        {cloudData?.error ? (
          <p role="alert" className="mx-3 mt-3 rounded-2xl border border-status-overdue/40 px-4 py-2 text-sm text-status-overdue sm:mx-6">
            {cloudData.error} <button type="button" className="underline" onClick={cloudData.reload}>Retry</button>
          </p>
        ) : null}
        {cloud?.me && cloud.me.profile.role === 'coordinator' && result.commitments.length === 0 && !dataset?.data.messages.length ? (
          <p className="mx-3 mt-3 rounded-2xl border border-surface-border bg-white/[0.04] px-4 py-3 text-sm text-text-muted sm:mx-6">
            Your workspace has no conversations yet. <a href="/setup" className="font-medium text-accent hover:underline">Import data or load the demo</a> to find commitments.
          </p>
        ) : null}
        <main id="main-content" key={location.pathname} className="app-enter flex-1 px-3 pb-24 pt-5 sm:px-6 md:pb-8">
          <Suspense fallback={<LoadingState label="Loading page" />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <BottomTabBar />
      <MobileNavSheet open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
    </div>
  )
}

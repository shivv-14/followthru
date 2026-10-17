import { Suspense, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { BottomTabBar } from './BottomTabBar'
import { MobileNavSheet } from './MobileNavSheet'
import { LoadingState, SkipLink } from '../ui'
import { OfflineBanner } from './OfflineBanner'
import { useEngine } from '../../store'

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const { ready, dataset, user } = useEngine()
  const location = useLocation()

  if (!ready) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <LoadingState label="Loading local data" />
      </div>
    )
  }
  // No data or nobody signed in: the login page handles both and returns here afterwards
  if (!dataset || !user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />

  return (
    <div className="flex min-h-dvh">
      <div className="app-backdrop" aria-hidden />
      <SkipLink />
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineBanner />
        <TopBar onOpenMobileNav={() => setMobileNavOpen(true)} />
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

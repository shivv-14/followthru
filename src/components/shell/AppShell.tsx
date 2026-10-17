import { Suspense, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
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

  if (!ready) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <LoadingState label="Loading local data" />
      </div>
    )
  }
  if (!dataset) return <Navigate to="/setup" replace />
  if (!user) return <Navigate to="/profiles" replace />

  return (
    <div className="flex min-h-dvh">
      <SkipLink />
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineBanner />
        <TopBar onOpenMobileNav={() => setMobileNavOpen(true)} />
        <main id="main-content" className="flex-1 px-3 pb-20 pt-4 sm:px-6 md:pb-6">
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

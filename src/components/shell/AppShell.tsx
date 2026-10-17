import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { BottomTabBar } from './BottomTabBar'
import { MobileNavSheet } from './MobileNavSheet'
import { SkipLink } from '../ui'

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <div className="flex min-h-dvh">
      <SkipLink />
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenMobileNav={() => setMobileNavOpen(true)} />
        <main id="main-content" className="flex-1 px-3 pb-20 pt-4 sm:px-6 md:pb-6">
          <Outlet />
        </main>
      </div>
      <BottomTabBar />
      <MobileNavSheet open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
    </div>
  )
}

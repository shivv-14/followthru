import { useRegisterSW } from 'virtual:pwa-register/react'

/** Shown when a new version has been downloaded; reloads into it on request. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  if (!needRefresh) return null
  return (
    <div role="status" className="glass-surface fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full px-4 py-2 text-sm md:bottom-6">
      <span className="text-text-primary">Update available</span>
      <button type="button" className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-white" onClick={() => updateServiceWorker(true)}>
        Reload
      </button>
      <button type="button" className="text-xs text-text-muted hover:text-text-primary" onClick={() => setNeedRefresh(false)}>
        Later
      </button>
    </div>
  )
}

import { useEffect, useState } from 'react'

/** Tells the user they are offline. Everything keeps working from local data. */
export function OfflineBanner() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  if (online) return null
  return (
    <div role="status" className="border-b border-status-tentative/40 bg-status-tentative/10 px-4 py-2 text-center text-xs text-status-tentative">
      You are offline. FollowThru keeps working with the data on this device.
    </div>
  )
}

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import clsx from 'clsx'
import { relative } from '../components/domain/view'
import { callApi } from './api'
import { useCloudData } from './CloudEngineProvider'
import { useCloud } from './session'

/** Last engine run and a "Run now" button for reviewers. */
export function EngineStatus() {
  const cloud = useCloud()
  const data = useCloudData()
  const [busy, setBusy] = useState(false)
  if (!cloud?.me || !data || cloud.me.profile.role === 'member') return null
  const last = data.lastRun
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        await callApi('engine/run', { trigger: 'manual' })
        data.reload()
        setBusy(false)
      }}
      title={last ? `Last engine run ${new Date(last.at).toLocaleString()} (${last.trigger}). Click to run now.` : 'The engine has not run yet. Click to run now.'}
      className="hidden h-9 items-center gap-1.5 rounded-full border border-pill-border bg-pill px-3 text-xs text-[#c4c2c3] hover:text-white md:inline-flex"
    >
      <RefreshCw size={12} aria-hidden className={clsx(busy && 'animate-spin')} />
      {busy ? 'Running…' : last ? `Synced ${relative(last.at, new Date().toISOString())}` : 'Run engine'}
    </button>
  )
}

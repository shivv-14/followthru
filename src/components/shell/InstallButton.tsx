import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import clsx from 'clsx'
import { Button, Dialog } from '../ui'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

/** Install on Android and desktop through the browser prompt; on iOS, show how to add it to the home screen. */
export function InstallButton({ className, label = 'Install app' }: { className?: string; label?: string }) {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null)
  const [iosHelp, setIosHelp] = useState(false)
  const [installed, setInstalled] = useState(() => typeof window !== 'undefined' && isStandalone())

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setPrompt(e as InstallPromptEvent)
    }
    const onInstalled = () => setInstalled(true)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (installed || (!prompt && !isIos())) return null

  async function install() {
    if (prompt) {
      await prompt.prompt()
      const choice = await prompt.userChoice
      if (choice.outcome === 'accepted') setInstalled(true)
      setPrompt(null)
    } else setIosHelp(true)
  }

  return (
    <>
      <button
        type="button"
        onClick={install}
        className={clsx('inline-flex items-center gap-1.5 rounded-full border border-surface-border bg-surface px-3 py-1.5 text-xs text-text-primary hover:bg-surface-hover', className)}
      >
        <Download size={13} aria-hidden />
        {label}
      </button>
      <Dialog open={iosHelp} onClose={() => setIosHelp(false)} title="Add FollowThru to your home screen">
        <ol className="mb-4 list-decimal pl-5 text-sm text-text-muted">
          <li>Tap the Share button in Safari.</li>
          <li>Choose Add to Home Screen.</li>
          <li>Open FollowThru from the new icon. It works offline after the first visit.</li>
        </ol>
        <Button onClick={() => setIosHelp(false)}>Got it</Button>
      </Dialog>
    </>
  )
}

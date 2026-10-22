/** Thin credit line fixed to the bottom of every page, in the same glass style as the rest of the app. */
export function CreditBar() {
  return (
    <footer className="fixed inset-x-0 bottom-0 z-30 flex h-7 items-center justify-center border-t border-surface-border bg-[#0b0b0d]/85 px-3 pb-[env(safe-area-inset-bottom)] text-[11px] tracking-wide text-white/70 backdrop-blur-xl">
      <span>
        Developed by{' '}
        <a
          href="https://www.linkedin.com/in/brungi-shiva-ganesh"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-accent underline-offset-2 hover:underline focus-visible:underline"
        >
          Brungi Shiva Ganesh
        </a>
      </span>
    </footer>
  )
}

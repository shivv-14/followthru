// The synthetic demo dataset is only offered behind this flag. True in local
// dev by default; in a production build it requires VITE_DEMO_MODE=true to
// be set explicitly, so a real deploy never shows invented data by accident.
export function isMockModeEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === 'true'
}

// Mock engine data must only ever render behind this flag. True in local
// dev by default; in a production build it requires VITE_DEMO_MODE=true to
// be set explicitly, so a real deploy never shows invented data by accident.
export function isMockModeEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === 'true'
}

// Commit on track a's back-a-p1 branch that published src/engine/types.ts,
// the contract src/mocks/engineResult.ts is typechecked against.
export const TRACK_A_CONTRACT_COMMIT = '864f3ed'

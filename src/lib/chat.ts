// Team chat: one conversation per team plus one for the whole workspace.
// Chat lines are ordinary messages, so the engine reads them like any import.

export const ALL_TEAMS = 'all'
export const MAX_CHAT_TEXT = 2000

export function chatThreadId(teamId: string): string {
  return `team-${teamId}`
}

export function chatTitle(teamId: string): string {
  return teamId === ALL_TEAMS ? 'Whole workspace' : `Team ${teamId}`
}

/** Coordinators use every chat; others use the workspace chat, their own team and teams they lead. */
export function canUseChat(role: string, ownTeam: string | undefined, ledTeams: string[], teamId: string): boolean {
  if (role === 'coordinator' || teamId === ALL_TEAMS) return true
  return teamId === ownTeam || ledTeams.includes(teamId)
}

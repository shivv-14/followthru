import type { ApiRequest, ApiResponse } from '../handlers'
import { HttpError, json } from './http'
import * as accounts from './routes/accounts'
import * as auth from './routes/auth'
import * as data from './routes/data'
import * as work from './routes/work'
import * as workspaces from './routes/workspaces'

type Handler = (req: ApiRequest) => Promise<ApiResponse>

/** POST /api/cloud/<route>. Every route checks the caller itself; none trusts ids, roles or organizations from the request. */
export const ROUTES: Record<string, Handler> = {
  'auth/signup': auth.signup,
  'auth/signup-member': auth.signupMember,
  'auth/login': auth.login,
  'auth/change-password': auth.changePassword,
  'auth/logout': auth.logout,
  'auth/me': auth.me,
  'accounts/list': accounts.listAccounts,
  'accounts/create': accounts.createAccount,
  'accounts/reset-password': accounts.resetPassword,
  'accounts/set-active': accounts.setActive,
  'accounts/update': accounts.updateAccount,
  'accounts/link-person': accounts.linkPerson,
  'teams/save': accounts.saveTeam,
  'teams/members': accounts.teamMembers,
  'tasks/create': work.createTasks,
  'tasks/decide': work.decide,
  'drafts/action': work.draftAction,
  'comments/add': work.addComment,
  'comments/edit': work.editComment,
  'comments/delete': work.deleteComment,
  'files/register': data.registerFile,
  'files/url': data.fileUrl,
  'files/delete': data.deleteFile,
  'data/import': data.importData,
  'data/reset': data.resetData,
  'engine/run': data.runEngineNow,
  'settings/update': data.updateSettings,
  'flows/save': data.saveFlow,
  'flows/delete': data.deleteFlow,
  'workspaces/list': workspaces.listWorkspaces,
  'workspaces/request': workspaces.requestToJoin,
  'workspaces/requests': workspaces.listJoinRequests,
  'workspaces/decide': workspaces.decideJoinRequest,
  'experiments/list': workspaces.listExperiments,
  'experiments/save': workspaces.saveExperiment,
}

export async function routeCloud(route: string, req: ApiRequest): Promise<ApiResponse> {
  const handler = ROUTES[route]
  if (!handler) return json(404, { error: { code: 'not_found', message: 'Unknown route' } })
  if (req.method !== 'POST') return { ...json(405, { error: { code: 'method_not_allowed', message: 'Use POST' } }), headers: { Allow: 'POST' } }
  try {
    return await handler(req)
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: { code: e.code, message: e.message, ...e.extra } })
    // Never send internal errors, SQL or stack traces to the browser
    console.error('cloud route failed', route, e instanceof Error ? e.message : e)
    return json(500, { error: { code: 'server_error', message: 'Something went wrong on the server. Nothing was changed.' } })
  }
}

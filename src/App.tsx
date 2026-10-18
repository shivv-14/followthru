import { lazy, Suspense } from 'react'
import { Navigate, Routes, Route, useLocation } from 'react-router-dom'
import { AppShell } from './components/shell/AppShell'
import { EngineProvider } from './store'
import { MaybeCloud } from './cloud/session'
import { cloudEnabled } from './lib/supabase'
import { RequireRole } from './components/shell/RequireRole'
import { RouteErrorBoundary } from './components/RouteErrorBoundary'
import { LoadingState } from './components/ui'
import Landing from './pages/Landing'
import NotFound from './pages/NotFound'

// Landing stays in the main bundle so the first screen paints at once; every other page loads on demand.
const Setup = lazy(() => import('./pages/Setup'))
const Login = lazy(() => import('./pages/Login'))
const CloudLogin = lazy(() => import('./pages/CloudLogin'))
const Signup = lazy(() => import('./pages/Signup'))
const ChangePassword = lazy(() => import('./pages/ChangePassword'))
const People = lazy(() => import('./pages/People'))
const Notifications = lazy(() => import('./pages/Notifications'))
const JoinTeam = lazy(() => import('./pages/JoinTeam'))
const Workspaces = lazy(() => import('./pages/Workspaces'))
const Experiment = lazy(() => import('./pages/Experiment'))
const TeamChat = lazy(() => import('./pages/TeamChat'))
const Automation = lazy(() => import('./pages/Automation'))
const Knowledge = lazy(() => import('./pages/Knowledge'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Commitments = lazy(() => import('./pages/Commitments'))
const CommitmentDetail = lazy(() => import('./pages/CommitmentDetail'))
const Queue = lazy(() => import('./pages/Queue'))
const Flows = lazy(() => import('./pages/Flows'))
const Team = lazy(() => import('./pages/Team'))
const Evidence = lazy(() => import('./pages/Evidence'))
const Styleguide = lazy(() => import('./pages/Styleguide'))

function PageFallback() {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <LoadingState label="Loading page" />
    </div>
  )
}

export default function App() {
  const location = useLocation()
  return (
    <MaybeCloud>
    <EngineProvider>
      <RouteErrorBoundary resetKey={location.pathname}>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/setup" element={<Setup />} />
            <Route path="/login" element={cloudEnabled ? <CloudLogin /> : <Login />} />
            {cloudEnabled ? <Route path="/signup" element={<Signup />} /> : null}
            {cloudEnabled ? <Route path="/join" element={<JoinTeam />} /> : null}
            {cloudEnabled ? <Route path="/workspaces" element={<Workspaces />} /> : null}
            {cloudEnabled ? <Route path="/change-password" element={<ChangePassword />} /> : null}
            <Route path="/profiles" element={<Navigate to="/login" replace />} />
            <Route path="/styleguide" element={<Styleguide />} />

            <Route element={<AppShell />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/commitments" element={<Commitments />} />
              <Route path="/commitments/:id" element={<CommitmentDetail />} />
              <Route path="/queue" element={<RequireRole role="coordinator"><Queue /></RequireRole>} />
              <Route path="/flows" element={<RequireRole role="coordinator"><Flows /></RequireRole>} />
              <Route path="/team" element={<Team />} />
              <Route path="/chat" element={<TeamChat />} />
              <Route path="/chat/:teamId" element={<TeamChat />} />
              <Route path="/evidence" element={<Evidence />} />
              {cloudEnabled ? <Route path="/people" element={<RequireRole role="coordinator"><People /></RequireRole>} /> : null}
              {cloudEnabled ? <Route path="/notifications" element={<Notifications />} /> : null}
              {cloudEnabled ? <Route path="/automation" element={<RequireRole role="coordinator"><Automation /></RequireRole>} /> : null}
              {/* One optional-segment route, so the filters survive moving between pages */}
              {cloudEnabled ? <Route path="/knowledge/:pageId?" element={<Knowledge />} /> : null}
              {cloudEnabled ? <Route path="/experiment" element={<RequireRole role="coordinator"><Experiment /></RequireRole>} /> : null}
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </RouteErrorBoundary>
    </EngineProvider>
    </MaybeCloud>
  )
}

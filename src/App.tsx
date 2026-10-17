import { lazy, Suspense } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { AppShell } from './components/shell/AppShell'
import { EngineProvider } from './store'
import { RequireRole } from './components/shell/RequireRole'
import { RouteErrorBoundary } from './components/RouteErrorBoundary'
import { LoadingState } from './components/ui'
import Landing from './pages/Landing'
import NotFound from './pages/NotFound'

// Landing stays in the main bundle so the first screen paints at once; every other page loads on demand.
const Setup = lazy(() => import('./pages/Setup'))
const ProfilePicker = lazy(() => import('./pages/ProfilePicker'))
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
    <EngineProvider>
      <RouteErrorBoundary resetKey={location.pathname}>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/setup" element={<Setup />} />
            <Route path="/profiles" element={<ProfilePicker />} />
            <Route path="/styleguide" element={<Styleguide />} />

            <Route element={<AppShell />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/commitments" element={<Commitments />} />
              <Route path="/commitments/:id" element={<CommitmentDetail />} />
              <Route path="/queue" element={<RequireRole role="coordinator"><Queue /></RequireRole>} />
              <Route path="/flows" element={<RequireRole role="coordinator"><Flows /></RequireRole>} />
              <Route path="/team" element={<Team />} />
              <Route path="/evidence" element={<Evidence />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </RouteErrorBoundary>
    </EngineProvider>
  )
}

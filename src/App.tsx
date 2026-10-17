import { Routes, Route } from 'react-router-dom'
import { AppShell } from './components/shell/AppShell'
import { EngineProvider } from './store'
import Landing from './pages/Landing'
import Setup from './pages/Setup'
import ProfilePicker from './pages/ProfilePicker'
import Dashboard from './pages/Dashboard'
import Commitments from './pages/Commitments'
import CommitmentDetail from './pages/CommitmentDetail'
import Queue from './pages/Queue'
import Flows from './pages/Flows'
import Team from './pages/Team'
import Evidence from './pages/Evidence'
import Styleguide from './pages/Styleguide'
import NotFound from './pages/NotFound'

export default function App() {
  return (
    <EngineProvider>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/profiles" element={<ProfilePicker />} />
        <Route path="/styleguide" element={<Styleguide />} />

        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/commitments" element={<Commitments />} />
          <Route path="/commitments/:id" element={<CommitmentDetail />} />
          <Route path="/queue" element={<Queue />} />
          <Route path="/flows" element={<Flows />} />
          <Route path="/team" element={<Team />} />
          <Route path="/evidence" element={<Evidence />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </EngineProvider>
  )
}

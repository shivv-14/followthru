import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource-variable/inter'
import './styles/global.css'
import App from './App.tsx'
import { UpdatePrompt } from './components/shell/UpdatePrompt'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      <UpdatePrompt />
    </BrowserRouter>
  </StrictMode>,
)

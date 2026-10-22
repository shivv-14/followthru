import '../styles/landing.css'
import '../styles/landing-theme.css'
import { Hero } from './landing/Hero'
import { ScrubStory } from './landing/ScrubStory'
import { MeadowFooter } from './landing/MeadowFooter'

/** Marketing landing: video hero, scroll-scrubbed story, meadow footer. */
export default function Landing() {
  return (
    <main className="landing">
      <Hero />
      <ScrubStory />
      <MeadowFooter />
    </main>
  )
}

import { useState } from 'react'
import {
  Button,
  Input,
  Card,
  CardHeader,
  CardTitle,
  StatusChip,
  Tabs,
  Dialog,
  EmptyState,
  LoadingState,
  ErrorState,
  type ButtonVariant,
} from '../components/ui'
import { Stage } from '../three/Stage'
import { color, spacing, radius, motion, breakpoint } from '../styles/tokens'
import type { StatusColorKey } from '../styles/tokens'

const statuses = Object.keys(color.status) as StatusColorKey[]
const variants: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger']

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-b border-surface-border pb-10">
      <h2 className="font-display text-xl font-semibold text-text-primary">{title}</h2>
      {children}
    </section>
  )
}

function Swatch({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="h-12 w-full rounded-md border border-surface-border" style={{ background: value }} />
      <span className="text-xs text-text-muted">{label}</span>
    </div>
  )
}

export default function Styleguide() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [errorValue, setErrorValue] = useState('')

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-10 px-4 py-10 sm:px-6">
      <header>
        <h1 className="font-display text-3xl font-semibold text-text-primary">Style guide</h1>
        <p className="text-text-muted">Every design token and UI primitive, for visual verification.</p>
      </header>

      <Section title="Color">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Swatch label="bg" value={color.bg} />
          <Swatch label="surface" value={color.surface} />
          <Swatch label="accent" value={color.accent} />
          <Swatch label="text primary" value={color.textPrimary} />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {statuses.map((key) => (
            <Swatch key={key} label={key} value={color.status[key]} />
          ))}
        </div>
      </Section>

      <Section title="Typography">
        <p className="font-display text-4xl text-text-primary">Space Grotesk display</p>
        <p className="font-body text-base text-text-primary">
          Inter body text — the quick brown fox jumps over the lazy dog.
        </p>
      </Section>

      <Section title="Spacing">
        <div className="flex flex-wrap items-end gap-3">
          {Object.entries(spacing).map(([key, value]) => (
            <div key={key} className="flex flex-col items-center gap-1">
              <div className="bg-accent" style={{ width: value, height: value }} />
              <span className="text-xs text-text-faint">{key}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Radii and shadows">
        <div className="flex flex-wrap gap-4">
          {Object.entries(radius).map(([key, value]) => (
            <div
              key={key}
              className="flex size-16 items-center justify-center bg-surface text-xs text-text-muted"
              style={{ borderRadius: value }}
            >
              {key}
            </div>
          ))}
          <div className="glass-surface flex size-16 items-center justify-center rounded-lg text-xs text-text-muted">
            glass
          </div>
        </div>
      </Section>

      <Section title="Focus ring">
        <p className="text-sm text-text-muted">Tab to this button — mouse click shows no ring.</p>
        <Button className="w-fit">Focus me with Tab</Button>
      </Section>

      <Section title="Motion and breakpoints">
        <ul className="grid grid-cols-2 gap-2 text-sm text-text-muted sm:grid-cols-4">
          {Object.entries(motion.duration).map(([key, value]) => (
            <li key={key}>
              {key}: {value}s
            </li>
          ))}
        </ul>
        <ul className="grid grid-cols-2 gap-2 text-sm text-text-muted sm:grid-cols-5">
          {Object.entries(breakpoint).map(([key, value]) => (
            <li key={key}>
              {key}: {value}px
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap gap-3">
          {variants.map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}
          <Button disabled>disabled</Button>
        </div>
      </Section>

      <Section title="Inputs">
        <div className="grid max-w-sm gap-4">
          <Input label="Name" placeholder="Priya Sharma" />
          <Input
            label="With error"
            value={errorValue}
            onChange={(event) => setErrorValue(event.target.value)}
            error={errorValue ? '' : 'This field is required'}
          />
          <Input label="With hint" hint="We use this to say hello" />
        </div>
      </Section>

      <Section title="Cards and status chips">
        <Card className="max-w-sm">
          <CardHeader>
            <CardTitle>Quarterly report</CardTitle>
            <StatusChip status="overdue" label="Overdue" />
          </CardHeader>
          <p className="text-sm text-text-muted">Owner: Priya. Due yesterday.</p>
        </Card>
        <div className="flex flex-wrap gap-2">
          {statuses.map((key) => (
            <StatusChip key={key} status={key} label={key} />
          ))}
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs
          items={[
            { value: 'active', label: 'Active', content: <p className="text-sm text-text-muted">Active items panel.</p> },
            { value: 'suppressed', label: 'Suppressed', content: <p className="text-sm text-text-muted">Suppressed items panel.</p> },
          ]}
        />
      </Section>

      <Section title="Dialog / bottom sheet">
        <Button onClick={() => setDialogOpen(true)} className="w-fit">
          Open dialog
        </Button>
        <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Example dialog">
          <p className="text-sm text-text-muted">
            Centered on desktop, a bottom sheet on small screens. Escape closes it, focus is trapped while open.
          </p>
        </Dialog>
      </Section>

      <Section title="Empty, loading and error states">
        <EmptyState title="Nothing here yet" description="This is what an empty list looks like." />
        <LoadingState rows={2} />
        <ErrorState description="This is what a failed request looks like." onRetry={() => {}} />
      </Section>

      <Section title="3D stage">
        <p className="text-sm text-text-muted">
          Lazy loaded, capped device pixel ratio. Falls back to a static 2D mark with no WebGL or reduced motion.
        </p>
        <Stage className="h-48 w-full max-w-sm" label="Style guide stage demo" />
      </Section>
    </main>
  )
}

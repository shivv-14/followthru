/**
 * Hero backdrop: a deadline dial. A glowing ring runs from teal (done) through cyan to amber (late),
 * with clock ticks, an orbiting "late" signal and a faint grid. Pure CSS, so it loads instantly.
 */
export function DeadlineOrbit() {
  return (
    <div className="do">
      <div className="do-grid" />
      <div className="do-orbit">
        <div className="do-glow" />
        <div className="do-ring" />
        <div className="do-ticks" />
        <div className="do-inner" />
        <div className="do-signal do-signal--late" />
        <div className="do-signal do-signal--done" />
      </div>
      <div className="do-horizon" />
      <div className="do-grain" />
    </div>
  )
}

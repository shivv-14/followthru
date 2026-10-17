import { EmptyState } from '../components/ui'

export interface RouteSkeletonProps {
  title: string
  description: string
}

/** Placeholder for screens that connect to real engine/store data in a later
 * phase. Phase 1 only establishes the route and layout, not the data shape. */
export function RouteSkeleton({ title, description }: RouteSkeletonProps) {
  return (
    <div className="mx-auto max-w-3xl">
      <EmptyState title={title} description={description} />
    </div>
  )
}

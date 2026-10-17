import { useParams } from 'react-router-dom'
import { RouteSkeleton } from './RouteSkeleton'

export default function CommitmentDetail() {
  const { id } = useParams<{ id: string }>()
  return (
    <RouteSkeleton
      title={`Commitment ${id ?? ''}`}
      description="The Why? panel, evidence timeline, and draft card connect to real engine data in a later phase."
    />
  )
}

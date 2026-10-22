import type { KbStatus } from '../../knowledge/rules'

export interface Space {
  id: string
  space_key: string
  name: string
  description: string | null
}

export interface PageSummary {
  id: string
  space_id: string
  parent_id: string | null
  slug: string
  title: string
  status: KbStatus
  tags: string[]
  owner_profile_id: string | null
  source: PageSource | null
  version: number
  row_version: number
  updated_at: string
}

export type PageSource = { kind: 'email'; emailId: string; threadId: string } | { kind: 'task'; taskKey: string } | { kind: string }

export interface Page extends PageSummary {
  body_md: string
}

export interface VersionInfo {
  version: number
  title: string
  status: KbStatus
  note: string | null
  createdAt: string
  editedBy: string | null
}

export interface PageDetail {
  page: Page
  space: { id: string; space_key: string; name: string } | null
  ownerName: string | null
  versions: VersionInfo[]
  shownVersion: { version: number; title: string; body_md: string; status: KbStatus; created_at: string } | null
}

export const STATUS_LABEL: Record<KbStatus, string> = { draft: 'Draft', review: 'In review', published: 'Published', archived: 'Archived' }
export const STATUS_TONE: Record<KbStatus, string> = { draft: 'text-text-muted', review: 'text-status-tentative', published: 'text-status-done', archived: 'text-text-faint' }

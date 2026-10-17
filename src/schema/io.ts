import Papa from 'papaparse'
import type { Commitment, Draft, EngineResult, Message, ValidationIssue } from '../engine/types'
import { issue } from './validate'

// Cells starting with these can run as formulas in spreadsheet apps.
const FORMULA_START = /^[=+\-@\t\r]/

/** Prefixes risky cells with a single quote so spreadsheets show them as text. */
export function escapeCsvCell(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value
}

/** Reverses escapeCsvCell on import. */
export function unescapeCsvCell(value: string): string {
  return value.startsWith("'") && FORMULA_START.test(value.slice(1)) ? value.slice(1) : value
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return escapeCsvCell(value.join(';'))
  return escapeCsvCell(String(value))
}

/** Writes rows as CSV with a fixed column order. Every cell is formula-escaped. */
export function toCsv<T extends object>(rows: T[], columns: (keyof T & string)[]): string {
  const data = rows.map((r) => columns.map((c) => cell(r[c])))
  return Papa.unparse({ fields: columns, data }, { newline: '\n' })
}

export const MESSAGE_CSV_COLUMNS = ['id', 'threadId', 'authorId', 'sentAt', 'text', 'replyToId', 'mentionIds'] as const
const REQUIRED_MESSAGE_COLUMNS = ['id', 'threadId', 'authorId', 'sentAt', 'text']

export function messagesToCsv(messages: Message[]): string {
  return toCsv(messages, [...MESSAGE_CSV_COLUMNS])
}

export interface CsvImportResult {
  messages: Message[]
  issues: ValidationIssue[]
}

/**
 * Reads messages from CSV. Rows are not validated for meaning here; pass the
 * result through validateDataset together with people.
 */
export function messagesFromCsv(text: string): CsvImportResult {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: true })
  const issues: ValidationIssue[] = parsed.errors.map((e) =>
    issue('csv_parse_error', 'error', ['csv', e.row ?? 0], e.message),
  )
  const columns = parsed.meta.fields ?? []
  const missing = REQUIRED_MESSAGE_COLUMNS.filter((c) => !columns.includes(c))
  missing.forEach((c) => issues.push(issue('csv_missing_column', 'error', ['csv', c], c)))
  if (missing.length > 0) return { messages: [], issues }

  const messages = parsed.data.map((row) => {
    const get = (k: string) => unescapeCsvCell(row[k] ?? '')
    const m: Message = { id: get('id'), threadId: get('threadId'), authorId: get('authorId'), sentAt: get('sentAt'), text: get('text') }
    if (get('replyToId')) m.replyToId = get('replyToId')
    if (get('mentionIds')) m.mentionIds = get('mentionIds').split(';').filter(Boolean)
    return m
  })
  return { messages, issues }
}

export interface CommitmentCsvRow {
  id: string
  title: string
  ownerId: string | null
  requesterId: string | null
  status: string
  dueAt: string | null
  certainty: string
  deadlinePhrase: string
  interpretedTz: string
  responseState: string
  needsReview: boolean
  reviewReasons: string[]
  evidenceMessageIds: string[]
}

export function commitmentsToCsv(commitments: Commitment[]): string {
  const rows: CommitmentCsvRow[] = commitments.map((c) => ({
    id: c.id,
    title: c.title,
    ownerId: c.ownerId,
    requesterId: c.requesterId,
    status: c.status,
    dueAt: c.deadline.dueAt,
    certainty: c.deadline.certainty,
    deadlinePhrase: c.deadline.phrase,
    interpretedTz: c.deadline.interpretedTz,
    responseState: c.responseState,
    needsReview: c.needsReview,
    reviewReasons: c.reviewReasons,
    evidenceMessageIds: [c.sourceMessageId, ...c.events.flatMap((e) => (e.evidence ? [e.evidence.messageId] : []))].filter(
      (v, i, a) => a.indexOf(v) === i,
    ),
  }))
  return toCsv(rows, [
    'id',
    'title',
    'ownerId',
    'requesterId',
    'status',
    'dueAt',
    'certainty',
    'deadlinePhrase',
    'interpretedTz',
    'responseState',
    'needsReview',
    'reviewReasons',
    'evidenceMessageIds',
  ])
}

export interface DraftCsvRow {
  id: string
  commitmentId: string
  kind: string
  recipientId: string | null
  recipientConfirmed: boolean
  state: string
  version: number
  suppressionReason: string
  updatedAt: string
  body: string
}

export function draftsToCsv(drafts: Draft[]): string {
  const rows: DraftCsvRow[] = drafts.map((d) => ({
    id: d.id,
    commitmentId: d.commitmentId,
    kind: d.kind,
    recipientId: d.recipientId,
    recipientConfirmed: d.recipientConfirmed,
    state: d.state,
    version: d.version,
    suppressionReason: d.suppression?.reason ?? '',
    updatedAt: d.updatedAt,
    body: d.editedBody ?? d.body,
  }))
  return toCsv(rows, ['id', 'commitmentId', 'kind', 'recipientId', 'recipientConfirmed', 'state', 'version', 'suppressionReason', 'updatedAt', 'body'])
}

export interface SuppressionCsvRow {
  draftId: string
  commitmentId: string
  reason: string
  at: string
  evidenceMessageId: string
}

/** One row per suppressed or stale draft, with the evidence message when there is one. */
export function suppressionsToCsv(drafts: Draft[]): string {
  const rows: SuppressionCsvRow[] = drafts
    .filter((d) => d.suppression)
    .map((d) => ({
      draftId: d.id,
      commitmentId: d.commitmentId,
      reason: d.suppression!.reason,
      at: d.suppression!.at,
      evidenceMessageId: d.suppression!.evidence?.messageId ?? '',
    }))
  return toCsv(rows, ['draftId', 'commitmentId', 'reason', 'at', 'evidenceMessageId'])
}

/** Engine results as pretty JSON with a stable key order. */
export function resultsToJson(result: EngineResult): string {
  const { runAt, mode, commitments, drafts, issues } = result
  return JSON.stringify({ runAt, mode, commitments, drafts, issues }, null, 2)
}

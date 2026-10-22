import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { Markdown } from '../src/components/domain/Markdown'
import { escapeMarkdown, parseInline, parseMarkdown, safeHref } from '../src/knowledge/markdown'
import { buildMinutesPage, type MinutesInput } from '../src/knowledge/minutesPage'
import { canChangeStatus, canEditPage, canReadPage, nextStatuses, normalizeTags, slugify } from '../src/knowledge/rules'

const html = (source: string) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Markdown, { source })))

describe('markdown renderer', () => {
  it('renders headings, lists, emphasis, code and safe links', () => {
    const out = html('# Title\n\n- **bold** and *italic*\n- `x < y`\n\n1. one\n2. two\n\nSee [docs](https://example.com/a?b=1) and [task](/commitments/c_1).')
    expect(out).toContain('<h1')
    expect(out).toContain('<strong')
    expect(out).toContain('<em>italic</em>')
    expect(out).toContain('<code')
    expect(out).toContain('x &lt; y')
    expect(out).toContain('<ol')
    expect(out).toContain('href="https://example.com/a?b=1"')
    expect(out).toContain('rel="noopener noreferrer nofollow"')
    expect(out).toContain('href="/commitments/c_1"')
  })

  it('escapes raw HTML instead of rendering it', () => {
    const out = html('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n# <b>hi</b>')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('<img')
    expect(out).not.toContain('<b>')
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('refuses javascript:, data: and protocol-relative links, keeping only their words', () => {
    for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', '//evil.example', '/\\evil.example', 'vbscript:x', 'mailto:a@b.c']) {
      const out = html(`[click me](${href})`)
      expect(out, href).not.toContain('href')
      expect(out, href).toContain('click me')
    }
    expect(safeHref('https://ok.example/path')).toBe('https://ok.example/path')
    expect(safeHref('java\tscript:alert(1)')).toBeNull()
    expect(safeHref('https://exa mple.com')).toBeNull()
  })

  it('treats escaped characters literally and keeps fenced code as text', () => {
    expect(parseInline('a \\*not bold\\* b')).toEqual([{ type: 'text', text: 'a *not bold* b' }])
    expect(parseMarkdown('```\n<b>x</b>\n# not a heading\n```')).toEqual([{ type: 'code', text: '<b>x</b>\n# not a heading' }])
    expect(html('```\n<b>x</b>\n```')).toContain('&lt;b&gt;x&lt;/b&gt;')
  })

  it('escapes text for safe use inside generated markdown', () => {
    expect(escapeMarkdown('use *stars* and [x](javascript:1)\nnext')).toBe('use \\*stars\\* and \\[x\\](javascript:1) next')
    expect(html(`- ${escapeMarkdown('[x](https://a.example)')}`)).not.toContain('href')
  })
})

const minutesInput = (over: Partial<MinutesInput> = {}): MinutesInput => ({
  emailId: '9f1c2d3e-0000-4000-8000-000000000001',
  threadId: 'th_42',
  subject: 'Weekly sync',
  sentAt: '2026-10-16T09:30:00.000Z',
  fromName: 'Asha',
  fromEmail: 'asha@example.com',
  toEmails: ['Ben@Example.com', 'cara@example.com'],
  summary: 'Weekly sync: 2 action items, 1 decision',
  minutes: { title: 'Weekly sync', decisions: ['Ship v2 on Monday'], discussion: ['Pricing *draft*'], open_questions: ['Who owns QA?'] },
  items: [
    { title: 'Send the deck', assignee_name: 'Ben', assignee_email: 'ben@example.com', deadline_text: 'Friday 5pm' },
    { title: 'Book the room', assignee_name: null, assignee_email: null, deadline_text: null },
  ],
  itemTaskKeys: ['c_m_abc_0', null],
  ...over,
})

describe('meeting minutes to knowledge base page', () => {
  it('builds a dated draft with every section, participants and ticket links', () => {
    const p = buildMinutesPage(minutesInput())
    expect(p.title).toBe('Weekly sync (2026-10-16)')
    expect(p.slug).toMatch(/^weekly-sync-2026-10-16-[a-z0-9-]+$/)
    expect(p.slug.length).toBeLessThanOrEqual(120)
    expect(p.tags).toEqual(['meeting-minutes'])
    expect(p.source).toEqual({ kind: 'email', emailId: '9f1c2d3e-0000-4000-8000-000000000001', threadId: 'th_42' })
    for (const heading of ['## Summary', '## Decisions', '## Discussion', '## Open questions', '## Action items']) expect(p.bodyMd).toContain(heading)
    expect(p.bodyMd).toContain('**Date:** 2026-10-16')
    expect(p.bodyMd).toContain('Asha <asha@example.com>, ben@example.com, cara@example.com')
    expect(p.bodyMd).toContain('- Ship v2 on Monday')
    expect(p.bodyMd).toContain('- Pricing \\*draft\\*')
    expect(p.bodyMd).toContain('Send the deck · owner: Ben · due: Friday 5pm · [ticket c\\_m\\_abc\\_0](/commitments/c_m_abc_0)')
    expect(p.bodyMd).toContain('Book the room · owner: not named · no ticket created')
  })

  it('is pure: the same email always gives the same page', () => {
    expect(buildMinutesPage(minutesInput())).toEqual(buildMinutesPage(minutesInput()))
  })

  it('renders the ticket link as an in-app link and keeps hostile email text inert', () => {
    const p = buildMinutesPage(minutesInput({ minutes: { title: '<script>x</script>', decisions: ['[pwn](javascript:alert(1))'], discussion: [], open_questions: [] } }))
    const out = html(p.bodyMd)
    expect(out).toContain('href="/commitments/c_m_abc_0"')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('javascript:alert(1)"')
    expect(out).toContain('<em>No discussion notes</em>')
  })

  it('falls back to the subject and marks empty sections', () => {
    const p = buildMinutesPage(minutesInput({ minutes: { title: '', decisions: [], discussion: [], open_questions: [] }, items: [], itemTaskKeys: [], fromName: null }))
    expect(p.title).toBe('Weekly sync (2026-10-16)')
    expect(p.bodyMd).toContain('_No decisions recorded_')
    expect(p.bodyMd).toContain('_No action items_')
    expect(p.bodyMd).toContain('**Participants:** asha@example.com')
  })
})

describe('knowledge base rules', () => {
  const draft = { status: 'draft' as const, ownerProfileId: 'u1' }
  const published = { status: 'published' as const, ownerProfileId: 'u1' }

  it('lets everyone read published pages, members only their own drafts', () => {
    expect(canReadPage(published, 'member', 'u2')).toBe(true)
    expect(canReadPage(draft, 'member', 'u2')).toBe(false)
    expect(canReadPage(draft, 'member', 'u1')).toBe(true)
    expect(canReadPage(draft, 'team_lead', 'u3')).toBe(true)
  })

  it('lets members edit only their own drafts, and nobody edit archived pages', () => {
    expect(canEditPage(draft, 'member', 'u1')).toBe(true)
    expect(canEditPage(published, 'member', 'u1')).toBe(false)
    expect(canEditPage(draft, 'member', 'u2')).toBe(false)
    expect(canEditPage(published, 'coordinator', 'u9')).toBe(true)
    expect(canEditPage({ status: 'archived', ownerProfileId: 'u1' }, 'coordinator', 'u9')).toBe(false)
  })

  it('walks draft, review, published, archived, with publish and archive for reviewers only', () => {
    expect(canChangeStatus(draft, 'review', 'member', 'u1')).toBe(true)
    expect(canChangeStatus(draft, 'published', 'coordinator', 'u9')).toBe(false)
    expect(canChangeStatus({ status: 'review', ownerProfileId: 'u1' }, 'published', 'member', 'u1')).toBe(false)
    expect(canChangeStatus({ status: 'review', ownerProfileId: 'u1' }, 'published', 'team_lead', 'u9')).toBe(true)
    expect(canChangeStatus(published, 'archived', 'member', 'u1')).toBe(false)
    expect(nextStatuses(published, 'coordinator', 'u9')).toEqual(['draft', 'archived'])
    expect(nextStatuses(draft, 'member', 'u2')).toEqual([])
  })

  it('makes slugs and cleans tags', () => {
    expect(slugify('  Café Réunion: Q3 plan!! ')).toBe('cafe-reunion-q3-plan')
    expect(slugify('***')).toBe('page')
    expect(normalizeTags('Design, design ,  roadmap q3')).toEqual({ ok: true, tags: ['design', 'roadmap-q3'] })
    expect(normalizeTags(['<script>']).ok).toBe(false)
    expect(normalizeTags(Array.from({ length: 21 }, (_, i) => `t${i}`)).ok).toBe(false)
  })
})

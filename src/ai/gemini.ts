import { z } from 'zod'
import type { AiSignal, Message, Person } from '../engine/types'

/** Stable low-cost model from https://ai.google.dev/gemini-api/docs/models (checked October 2026). */
export const GEMINI_MODEL = 'gemini-3.5-flash-lite'
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'
const BATCH = 40
const KINDS = ['commitment', 'completion', 'cancellation', 'deferral', 'other'] as const

export type AiPassResult = { ok: true; signals: AiSignal[]; model: string } | { ok: false; reason: string }

const SYSTEM = [
  'You label workplace chat messages for a follow-up tracker.',
  'For each message return exactly one kind:',
  'commitment = the author promises or accepts a task;',
  'completion = the author says a task is finished;',
  'cancellation = a task is called off;',
  'deferral = a task is postponed with no new date;',
  'other = anything else, including questions and hedged maybes.',
  'Give a confidence from 0 to 1. Use only the message ids you are given.',
].join(' ')

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    signals: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { messageId: { type: 'STRING' }, kind: { type: 'STRING', enum: [...KINDS] }, confidence: { type: 'NUMBER' } },
        required: ['messageId', 'kind', 'confidence'],
      },
    },
  },
  required: ['signals'],
}

const replySchema = z.object({
  signals: z.array(z.object({ messageId: z.string(), kind: z.enum(KINDS), confidence: z.number() })),
})

const geminiResponse = z.looseObject({
  candidates: z.array(z.looseObject({ content: z.looseObject({ parts: z.array(z.looseObject({ text: z.string().optional() })) }) })).optional(),
  promptFeedback: z.looseObject({ blockReason: z.string().optional() }).optional(),
})

function promptFor(messages: Message[], people: Map<string, Person>): string {
  return messages.map((m) => JSON.stringify({ id: m.id, author: people.get(m.authorId)?.name ?? m.authorId, text: m.text })).join('\n')
}

/**
 * Asks Gemini what each message is. Any failure returns a reason instead of throwing,
 * so the caller can fall back to the rules and label the run "Rules (fallback)".
 * The key goes in a header, never the URL, so it does not end up in logs or history.
 */
export async function fetchAiSignals(
  messages: Message[],
  people: Map<string, Person>,
  opts: { apiKey: string; model?: string; fetchImpl?: typeof fetch; signal?: AbortSignal },
): Promise<AiPassResult> {
  const apiKey = opts.apiKey.trim()
  if (!apiKey) return { ok: false, reason: 'No API key saved' }
  const model = opts.model ?? GEMINI_MODEL
  const doFetch = opts.fetchImpl ?? fetch
  const known = new Set(messages.map((m) => m.id))
  const signals: AiSignal[] = []

  for (let i = 0; i < messages.length; i += BATCH) {
    let res: Response
    try {
      res = await doFetch(`${ENDPOINT}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: promptFor(messages.slice(i, i + BATCH), people) }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
        }),
        signal: opts.signal,
      })
    } catch (e) {
      return { ok: false, reason: (e as Error).name === 'AbortError' ? 'Cancelled' : 'Network error, the AI service could not be reached' }
    }
    if (!res.ok) return { ok: false, reason: res.status === 400 || res.status === 403 ? `The AI service refused the request (HTTP ${res.status}); check the key` : `The AI service returned HTTP ${res.status}` }

    const body = geminiResponse.safeParse(await res.json().catch(() => null))
    if (!body.success) return { ok: false, reason: 'The AI service sent an unexpected response' }
    if (body.data.promptFeedback?.blockReason) return { ok: false, reason: `The AI service blocked the request (${body.data.promptFeedback.blockReason})` }
    const text = body.data.candidates?.[0]?.content.parts.map((p) => p.text ?? '').join('') ?? ''
    let parsed: z.infer<typeof replySchema>
    try {
      const r = replySchema.safeParse(JSON.parse(text))
      if (!r.success) return { ok: false, reason: 'The AI answer did not match the expected format' }
      parsed = r.data
    } catch {
      return { ok: false, reason: 'The AI answer was not valid JSON' }
    }
    for (const s of parsed.signals) {
      // Ignore ids the model made up, and clamp confidence into 0..1
      if (known.has(s.messageId)) signals.push({ messageId: s.messageId, kind: s.kind, confidence: Math.min(1, Math.max(0, s.confidence)) })
    }
  }
  return { ok: true, signals, model }
}

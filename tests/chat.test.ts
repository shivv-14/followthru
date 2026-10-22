import { describe, expect, it } from 'vitest'
import demo from '../src/mocks/demoDataset.json'
import { validateDataset } from '../src/schema/validate'
import { makeConfig, runEngine } from '../src/engine'
import { applyReaction, chatTeamOf, groupThreads, likePattern, matchesSearch, mentionQuery, mentionedIds, normaliseReactions, reactionsOf } from '../src/lib/chat'

describe('chat reactions', () => {
  it('adds, removes and toggles one person without touching others', () => {
    const a = applyReaction(undefined, '👍', 'p_lena', true)
    expect(a).toEqual({ '👍': ['p_lena'] })
    const b = applyReaction(a, '👍', 'p_amir', true)
    expect(b).toEqual({ '👍': ['p_amir', 'p_lena'] })
    expect(applyReaction(b, '👍', 'p_lena', false)).toEqual({ '👍': ['p_amir'] })
    expect(applyReaction(b, '👍', 'p_lena')).toEqual({ '👍': ['p_amir'] })
    expect(applyReaction(b, '🎉', 'p_lena')).toEqual({ '👍': ['p_amir', 'p_lena'], '🎉': ['p_lena'] })
  })

  it('is idempotent: repeating the same wanted state changes nothing', () => {
    const once = applyReaction({}, '✅', 'p_priya', true)
    expect(applyReaction(once, '✅', 'p_priya', true)).toEqual(once)
    const off = applyReaction(once, '✅', 'p_priya', false)
    expect(off).toEqual({})
    expect(applyReaction(off, '✅', 'p_priya', false)).toEqual({})
  })

  it('drops empty lists, unknown emoji, duplicates and junk from stored values', () => {
    expect(normaliseReactions({ '👍': ['b', 'a', 'a', 7, ''], '💩': ['x'], '👀': [] })).toEqual({ '👍': ['a', 'b'] })
    expect(normaliseReactions(null)).toEqual({})
    expect(normaliseReactions(['👍'])).toEqual({})
    expect(reactionsOf({ mentions: ['p_x'], reactions: { '🎉': ['p_x'] } })).toEqual({ '🎉': ['p_x'] })
    expect(reactionsOf(null)).toEqual({})
  })

  it('does not mutate its input', () => {
    const before = { '👍': ['p_lena'] }
    applyReaction(before, '👍', 'p_amir', true)
    expect(before).toEqual({ '👍': ['p_lena'] })
  })

  it('reactions on a message are never engine input', () => {
    const data = validateDataset(demo).data!
    const config = makeConfig(data.referenceTime!)
    const plain = runEngine({ dataset: data }, config)
    const reacted = { ...data, messages: data.messages.map((m) => ({ ...m, reactions: { '✅': ['p_priya', 'p_lena'] } })) }
    expect(runEngine({ dataset: reacted }, config)).toEqual(plain)
  })
})

describe('chat threads, search and mentions', () => {
  const lines = [
    { id: 'a', text: 'Root one', authorName: 'Priya' },
    { id: 'b', text: 'Reply to one', authorName: 'Lena', replyToId: 'a' },
    { id: 'c', text: 'Root two', authorName: 'Amir' },
    { id: 'd', text: 'Reply to the reply', authorName: 'Amir', replyToId: 'b' },
    { id: 'e', text: 'Orphan', authorName: 'Lena', replyToId: 'gone' },
  ]

  it('groups replies, including replies to replies, under their top message', () => {
    const { roots, replies } = groupThreads(lines)
    expect(roots.map((l) => l.id)).toEqual(['a', 'c', 'e'])
    expect(replies.get('a')?.map((l) => l.id)).toEqual(['b', 'd'])
    expect(replies.has('c')).toBe(false)
  })

  it('searches text and author names case-insensitively', () => {
    expect(lines.filter((l) => matchesSearch(l, 'REPLY')).map((l) => l.id)).toEqual(['b', 'd'])
    expect(lines.filter((l) => matchesSearch(l, 'amir')).map((l) => l.id)).toEqual(['c', 'd'])
    expect(lines.filter((l) => matchesSearch(l, '  ')).length).toBe(5)
  })

  it('escapes LIKE wildcards', () => {
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%')
  })

  it('finds the @partial before the caret and the people mentioned by full name', () => {
    expect(mentionQuery('Hi @Le', 6)).toEqual({ start: 3, query: 'Le' })
    expect(mentionQuery('Hi @', 4)).toEqual({ start: 3, query: '' })
    expect(mentionQuery('mail a@b', 8)).toBeNull()
    expect(mentionQuery('Hi @Lena Ortiz ', 15)).toBeNull()
    const people = [
      { id: 'p_lena', name: 'Lena Ortiz' },
      { id: 'p_len', name: 'Len' },
      { id: 'p_amir', name: 'Amir Khan' },
    ]
    expect(mentionedIds('@Lena Ortiz can you check with @amir khan?', people)).toEqual(['p_lena', 'p_amir'])
    expect(mentionedIds('@Lena Ortiz only', people)).toEqual(['p_lena'])
    expect(mentionedIds('no mentions, Lena Ortiz', people)).toEqual([])
  })

  it('maps chat thread ids back to teams', () => {
    expect(chatTeamOf('team-design')).toBe('design')
    expect(chatTeamOf('t_launch')).toBeNull()
  })
})

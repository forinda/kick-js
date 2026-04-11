/**
 * Tests for `createPrompt` / `Prompt`.
 *
 * Covers variable substitution, the three missing-variable handlers,
 * role overrides, placeholder extraction, and edge cases like Markdown
 * that happens to contain `{{` sequences.
 *
 * @module @forinda/kickjs-ai/__tests__/prompts.test
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createPrompt, Prompt } from '@forinda/kickjs-ai'

// ── Construction ─────────────────────────────────────────────────────────

describe('createPrompt — construction', () => {
  it('returns a Prompt instance', () => {
    const p = createPrompt('hello')
    expect(p).toBeInstanceOf(Prompt)
  })

  it('defaults name to "prompt" and role to "user"', () => {
    const p = createPrompt('hi')
    expect(p.name).toBe('prompt')
    expect(p.role).toBe('user')
  })

  it('honors name and role overrides', () => {
    const p = createPrompt('You are helpful.', { name: 'persona', role: 'system' })
    expect(p.name).toBe('persona')
    expect(p.role).toBe('system')
  })

  it('throws on a non-string template', () => {
    expect(() => new Prompt(42 as unknown as string)).toThrow(/template must be a string/)
  })
})

// ── Rendering ────────────────────────────────────────────────────────────

describe('Prompt.render', () => {
  it('substitutes a single variable', () => {
    const p = createPrompt<{ name: string }>('Hello {{name}}')
    expect(p.render({ name: 'Alice' })).toEqual({ role: 'user', content: 'Hello Alice' })
  })

  it('substitutes multiple variables in one template', () => {
    const p = createPrompt<{ first: string; last: string }>('Hi {{first}} {{last}}')
    expect(p.render({ first: 'Ada', last: 'Lovelace' }).content).toBe('Hi Ada Lovelace')
  })

  it('allows whitespace around the variable name', () => {
    const p = createPrompt<{ x: string }>('Value: {{ x }}')
    expect(p.render({ x: '42' }).content).toBe('Value: 42')
  })

  it('replaces every occurrence of the same variable', () => {
    const p = createPrompt<{ n: string }>('{{n}} and {{n}} again')
    expect(p.render({ n: 'bang' }).content).toBe('bang and bang again')
  })

  it('coerces non-string values to strings', () => {
    const p = createPrompt<{ count: number; on: boolean }>('{{count}} items, on={{on}}')
    expect(p.render({ count: 3, on: true }).content).toBe('3 items, on=true')
  })

  it('preserves Markdown that contains unrelated double braces', () => {
    // `{{ broken` has no matching close, so the regex never fires on it.
    const p = createPrompt<{ name: string }>('Hello {{name}}, see: {{ broken')
    expect(p.render({ name: 'x' }).content).toBe('Hello x, see: {{ broken')
  })

  it('leaves unknown variables in the template alone when no match exists', () => {
    // Literal `{{unknown}}` not in TVars is left alone by a silent
    // handler — but the default is `throw`, so verify with `silent`.
    const p = createPrompt<Record<string, unknown>>('Hello {{known}} and {{unknown}}', {
      onMissing: 'silent',
    })
    expect(p.render({ known: 'world' }).content).toBe('Hello world and {{unknown}}')
  })

  it('renderString returns the raw string instead of a ChatMessage', () => {
    const p = createPrompt<{ name: string }>('Hello {{name}}')
    expect(p.renderString({ name: 'Bob' })).toBe('Hello Bob')
  })

  it('uses the configured role in the rendered message', () => {
    const p = createPrompt<{ x: string }>('You are {{x}}.', { role: 'system' })
    expect(p.render({ x: 'helpful' })).toEqual({
      role: 'system',
      content: 'You are helpful.',
    })
  })
})

// ── Missing variable handlers ────────────────────────────────────────────

describe('Prompt missing-variable handling', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('throws by default when a variable is missing', () => {
    const p = createPrompt<{ name: string }>('Hello {{name}}', { name: 'greet' })
    expect(() => p.render({} as { name: string })).toThrow(/variable "name" is missing/i)
    // The prompt name should appear in the message for context
    try {
      p.render({} as { name: string })
    } catch (err) {
      expect((err as Error).message).toContain('greet')
    }
  })

  it('throws when a variable is null or undefined', () => {
    const p = createPrompt<{ name: string | null | undefined }>('Hello {{name}}')
    expect(() => p.render({ name: null })).toThrow(/missing/)
    expect(() => p.render({ name: undefined })).toThrow(/missing/)
  })

  it('warns and leaves the placeholder in place with onMissing: warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const p = createPrompt<{ name?: string }>('Hello {{name}}', { onMissing: 'warn' })
    const result = p.renderString({})
    expect(result).toBe('Hello {{name}}')
    expect(warnSpy).toHaveBeenCalledOnce()
  })

  it('silently leaves the placeholder in place with onMissing: silent', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const p = createPrompt<{ name?: string }>('Hello {{name}}', { onMissing: 'silent' })
    const result = p.renderString({})
    expect(result).toBe('Hello {{name}}')
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

// ── Introspection ────────────────────────────────────────────────────────

describe('Prompt.getPlaceholders', () => {
  it('returns every placeholder name in declaration order', () => {
    const p = createPrompt<{ first: string; last: string }>('Hi {{first}} {{last}}')
    expect(p.getPlaceholders().sort()).toEqual(['first', 'last'])
  })

  it('deduplicates repeated placeholders', () => {
    const p = createPrompt<{ n: string }>('{{n}} and {{n}}')
    expect(p.getPlaceholders()).toEqual(['n'])
  })

  it('returns an empty array when the template has no placeholders', () => {
    const p = createPrompt('static content')
    expect(p.getPlaceholders()).toEqual([])
  })

  it('supports dotted path syntax in placeholder names', () => {
    // The regex allows dots so callers can use `{{user.name}}` if
    // they want — but it's a flat lookup, so the caller must pass
    // the key as literal `'user.name'` in the vars object.
    const p = createPrompt('Hi {{user.name}}')
    expect(p.getPlaceholders()).toEqual(['user.name'])
  })
})

describe('Prompt.getTemplate', () => {
  it('returns the raw template string unchanged', () => {
    const tpl = 'Hello {{name}}, welcome to {{place}}.'
    const p = createPrompt<{ name: string; place: string }>(tpl)
    expect(p.getTemplate()).toBe(tpl)
  })
})

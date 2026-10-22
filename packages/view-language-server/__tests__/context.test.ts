import { describe, expect, it } from 'vitest'
import { cursorContext } from '../src/context'
import { cursor } from './helpers'

const ctx = (marked: string) => {
  const { text, offset } = cursor(marked)
  return cursorContext(text, offset)
}

describe('cursorContext', () => {
  it('keywords after @ in text', () => {
    expect(ctx('<p>@i§')).toEqual({ kind: 'keyword', prefix: 'i' })
    expect(ctx('hi@ex§')).toEqual({ kind: 'other' })
  })
  it('pipes after |', () => {
    expect(ctx('{{ a | ti§')).toEqual({ kind: 'pipe', prefix: 'ti' })
    expect(ctx('<p [title]="a | up§">')).toEqual({ kind: 'pipe', prefix: 'up' })
  })
  it('expressions with what is in scope', () => {
    expect(ctx('{{ us§')).toMatchObject({ kind: 'expr', prefix: 'us', scope: [] })
    expect(ctx('@for (x of xs) { {{ §')).toMatchObject({
      kind: 'expr',
      scope: ['x', '$index', '$first', '$last', '$even', '$odd', '$count'],
    })
    expect(ctx('@for ([k, v] of m; let i = $index) { {{ §')).toMatchObject({
      scope: ['k', 'v', 'i', '$index', '$first', '$last', '$even', '$odd', '$count'],
    })
    expect(ctx('@for (x of xs) { } {{ §')).toMatchObject({ scope: [] })
    expect(ctx('@let t = 1;{{ §')).toMatchObject({ scope: ['t'] })
    expect(ctx('@if (a; as b) { {{ §')).toMatchObject({ scope: ['b'] })
    expect(ctx("@error('title') { {{ §")).toMatchObject({ scope: ['$message'] })
    expect(ctx('@input user\n<p>{{ §')).toMatchObject({ scope: ['user'] })
    expect(ctx('@if (us§')).toMatchObject({ kind: 'expr', prefix: 'us' })
    expect(ctx('{{ a.b§')).toEqual({ kind: 'other' })
  })
  it('tags and component attributes', () => {
    expect(ctx('<us§')).toEqual({ kind: 'tag', prefix: 'us' })
    expect(ctx('<user-card [u§')).toEqual({ kind: 'attr', tag: 'user-card', prefix: 'u' })
    expect(ctx('<user-card class="x" §')).toEqual({ kind: 'attr', tag: 'user-card', prefix: '' })
    expect(ctx('<p cla§')).toEqual({ kind: 'other' })
  })
  it('names inside @layout and @slot', () => {
    expect(ctx("@layout('lay§")).toEqual({ kind: 'template-name', prefix: 'lay' })
    expect(ctx("@slot('he§")).toEqual({ kind: 'slot-name', prefix: 'he' })
  })
})

import { describe, expect, it } from 'vitest'
import { kickTokens } from '../src/plugin/tokens'

/** `[text, type]` for each token, in order. */
const t = (src: string) =>
  kickTokens(src, (tag) => tag === 'user-card').map((k) => [
    src.slice(k.offset, k.offset + k.length),
    k.type,
  ])

describe('kickTokens', () => {
  it('interpolations: delimiters, names, properties, pipes', () => {
    expect(t('<p>{{ user.name | titlecase }}</p>')).toEqual([
      ['{{', 'operator'],
      ['user', 'variable'],
      ['name', 'property'],
      ['|', 'operator'],
      ['titlecase', 'function'],
      ['}}', 'operator'],
    ])
  })
  it('literals and pipe arguments', () => {
    expect(t("{{ at | date:'short' }} {{ 3 }} {{ ok ?? true }} {{ a || b }}")).toEqual([
      ['{{', 'operator'],
      ['at', 'variable'],
      ['|', 'operator'],
      ['date', 'function'],
      ["'short'", 'string'],
      ['}}', 'operator'],
      ['{{', 'operator'],
      ['3', 'number'],
      ['}}', 'operator'],
      ['{{', 'operator'],
      ['ok', 'variable'],
      ['true', 'keyword'],
      ['}}', 'operator'],
      ['{{', 'operator'],
      ['a', 'variable'],
      ['b', 'variable'],
      ['}}', 'operator'],
    ])
  })
  it('control flow and its headers', () => {
    expect(t('@for (u of users; track u.id; let i = $index) {\n} @empty {\n}')).toEqual([
      ['@for', 'keyword'],
      ['u', 'variable'],
      ['of', 'keyword'],
      ['users', 'variable'],
      ['track', 'keyword'],
      ['u', 'variable'],
      ['id', 'property'],
      ['let', 'keyword'],
      ['i', 'variable'],
      ['$index', 'variable'],
      ['@empty', 'keyword'],
    ])
    expect(t('@if (a; as b) {\n} @else if (c) {\n} @else {\n}')).toEqual([
      ['@if', 'keyword'],
      ['a', 'variable'],
      ['as', 'keyword'],
      ['b', 'variable'],
      ['@else if', 'keyword'],
      ['c', 'variable'],
      ['@else', 'keyword'],
    ])
  })
  it('directives, inputs, @let and comments', () => {
    expect(
      t(
        "@layout('layouts/main')\n@input user\n@input compact = false\n@let n = user.name;\n{{-- note --}}\n@slot('head') {\n}",
      ),
    ).toEqual([
      ['@layout', 'keyword'],
      ["'layouts/main'", 'string'],
      ['@input', 'keyword'],
      ['user', 'parameter'],
      ['@input', 'keyword'],
      ['compact', 'parameter'],
      ['false', 'keyword'],
      ['@let', 'keyword'],
      ['n', 'variable'],
      ['user', 'variable'],
      ['name', 'property'],
      ['{{-- note --}}', 'comment'],
      ['@slot', 'keyword'],
      ["'head'", 'string'],
    ])
  })
  it('components, bindings and interpolated attributes', () => {
    expect(t('<user-card [user]="u" compact></user-card><a href="/u/{{ id }}">x</a><div>')).toEqual(
      [
        ['user-card', 'class'],
        ['user', 'property'],
        ['u', 'variable'],
        ['user-card', 'class'],
        ['{{', 'operator'],
        ['id', 'variable'],
        ['}}', 'operator'],
      ],
    )
  })
  it('leaves @verbatim, script and style content alone, and e-mail @s', () => {
    expect(t('@verbatim {\n{{ x }} @if\n}\n<script>if (a) {}</script>me@if.com')).toEqual([
      ['@verbatim', 'keyword'],
    ])
  })
})

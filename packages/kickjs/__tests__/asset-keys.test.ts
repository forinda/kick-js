// Coverage for the shared asset-key strategy used by build / runtime
// / typegen. The function is pure — every test here is a string-in /
// string-out comparison with no fs side effects.

import { describe, expect, it } from 'vitest'

import { groupAssetKeys, stripExt } from '../src/core/asset-keys'

describe('stripExt', () => {
  it('strips a trailing extension', () => {
    expect(stripExt('mails/welcome.ejs')).toBe('mails/welcome')
  })

  it('returns the input unchanged when there is no extension', () => {
    expect(stripExt('mails/welcome')).toBe('mails/welcome')
  })

  it('preserves all but the final extension on multi-dot filenames', () => {
    expect(stripExt('archives/snapshot.tar.gz')).toBe('archives/snapshot.tar')
  })

  it('does not strip a leading dot (hidden file)', () => {
    // .env / .htaccess style files keep the dot — there's no extension
    // before the dot, so the algorithm leaves them alone.
    expect(stripExt('.env')).toBe('.env')
    expect(stripExt('config/.htaccess')).toBe('config/.htaccess')
  })

  it('preserves the directory part', () => {
    expect(stripExt('a/b/c/file.ext')).toBe('a/b/c/file')
  })
})

describe('groupAssetKeys — strategy=strip (legacy behaviour)', () => {
  it('strips extensions on every key', () => {
    const r = groupAssetKeys('mails', ['welcome.ejs', 'reminder.html', 'reset.txt'], {
      strategy: 'strip',
    })
    expect(r.pairs.map((p) => p.key)).toEqual(['mails/welcome', 'mails/reminder', 'mails/reset'])
    expect(r.collisionGroupsResolved).toBe(0)
  })

  it('does not auto-detect collisions in strip mode (caller decides what to do)', () => {
    // strip is opt-in — the caller asked for last-wins semantics.
    const r = groupAssetKeys('pages', ['index.pug', 'index.html'], { strategy: 'strip' })
    expect(r.pairs.map((p) => p.key)).toEqual(['pages/index', 'pages/index'])
    expect(r.collisionGroupsResolved).toBe(0)
  })
})

describe('groupAssetKeys — strategy=with-extension', () => {
  it('keeps the full extension on every key', () => {
    const r = groupAssetKeys('pages', ['index.pug', 'index.html', 'index.css', 'about.html'], {
      strategy: 'with-extension',
    })
    expect(r.pairs.map((p) => p.key)).toEqual([
      'pages/index.pug',
      'pages/index.html',
      'pages/index.css',
      'pages/about.html',
    ])
    expect(r.collisionGroupsResolved).toBe(0)
  })
})

describe('groupAssetKeys — strategy=auto (default)', () => {
  it('strips when basenames are unique', () => {
    const r = groupAssetKeys('mails', ['welcome.ejs', 'reminder.html', 'reset.txt'])
    expect(r.pairs.map((p) => p.key)).toEqual(['mails/welcome', 'mails/reminder', 'mails/reset'])
    expect(r.collisionGroupsResolved).toBe(0)
  })

  it('keeps extensions on the colliding group only', () => {
    const r = groupAssetKeys('pages', [
      'about.html', // unique → strip
      'index.pug', // colliding triple → keep ext
      'index.html',
      'index.css',
      'contact.md', // unique → strip
    ])
    expect(r.pairs.map((p) => p.key)).toEqual([
      'pages/about',
      'pages/index.pug',
      'pages/index.html',
      'pages/index.css',
      'pages/contact',
    ])
    expect(r.collisionGroupsResolved).toBe(1)
  })

  it('counts every distinct collision group separately', () => {
    const r = groupAssetKeys('pages', [
      'index.pug',
      'index.html',
      'about.pug',
      'about.html',
      'contact.html',
    ])
    expect(r.pairs.map((p) => p.key)).toEqual([
      'pages/index.pug',
      'pages/index.html',
      'pages/about.pug',
      'pages/about.html',
      'pages/contact', // unique → stripped
    ])
    expect(r.collisionGroupsResolved).toBe(2)
  })

  it('preserves input order in the output', () => {
    // Walk-order determinism matters for manifest stability + diff
    // hygiene. Output `pairs` should match input `paths` 1:1.
    const r = groupAssetKeys('p', ['c.txt', 'a.html', 'b.css'])
    expect(r.pairs.map((p) => p.rel)).toEqual(['c.txt', 'a.html', 'b.css'])
  })

  it('handles nested paths with a collision in the same subdir', () => {
    const r = groupAssetKeys('docs', [
      'guide/intro.md',
      'guide/intro.pdf',
      'guide/setup.md',
      'reference/api.md',
    ])
    expect(r.pairs.map((p) => p.key)).toEqual([
      'docs/guide/intro.md',
      'docs/guide/intro.pdf',
      'docs/guide/setup', // unique
      'docs/reference/api', // unique
    ])
    expect(r.collisionGroupsResolved).toBe(1)
  })

  it('treats files with no extension as their own group (no collision)', () => {
    const r = groupAssetKeys('docs', ['README', 'guide/intro.md'])
    expect(r.pairs.map((p) => p.key)).toEqual(['docs/README', 'docs/guide/intro'])
    expect(r.collisionGroupsResolved).toBe(0)
  })

  it('a basename collision mixing extension + no-extension keeps both', () => {
    // README + README.md in the same dir → both kept; the no-ext
    // file becomes 'docs/README' (its full path) and the .md file
    // becomes 'docs/README.md'.
    const r = groupAssetKeys('docs', ['README', 'README.md'])
    expect(r.pairs.map((p) => p.key)).toEqual(['docs/README', 'docs/README.md'])
    expect(r.collisionGroupsResolved).toBe(1)
  })

  it('returns an empty result for empty input', () => {
    const r = groupAssetKeys('any', [])
    expect(r.pairs).toEqual([])
    expect(r.collisionGroupsResolved).toBe(0)
  })
})

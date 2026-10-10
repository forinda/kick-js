import { describe, it, expect } from 'vitest'
import { fontStack } from '../spa/src/lib/fonts'

describe('fontStack', () => {
  it('puts the viewer fonts first, quoted, ahead of ours', () => {
    expect(fontStack('Inter', 'ui-sans-serif, sans-serif')).toBe(
      '"Inter", ui-sans-serif, sans-serif',
    )
    expect(fontStack(' "JetBrains Mono" , Fira Code ', 'monospace')).toBe(
      '"JetBrains Mono", "Fira Code", monospace',
    )
  })

  it('adds nothing for empty input and strips what could break the declaration', () => {
    expect(fontStack('', 'monospace')).toBeUndefined()
    expect(fontStack(' , ', 'monospace')).toBeUndefined()
    expect(fontStack('Bad"; color: red; {x}', 'monospace')).toBe('"Bad color: red x", monospace')
  })
})

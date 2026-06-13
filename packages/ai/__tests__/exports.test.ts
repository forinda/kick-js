import { describe, it, expect } from 'vitest'

import * as ai from '../src/index'

describe('@forinda/kickjs-ai public exports', () => {
  it('exports AI_ADAPTER (the documented @Inject token for the adapter instance)', () => {
    // The README and the adapter's own JSDoc document
    // `import { AI_ADAPTER, type AiAdapterInstance } from '@forinda/kickjs-ai'`
    // — both must be reachable from the package root.
    expect(ai.AI_ADAPTER).toBeDefined()
    expect((ai.AI_ADAPTER as { name?: string }).name).toBe('kick/ai/adapter')
  })

  it('still exports the provider/store tokens', () => {
    expect(ai.AI_PROVIDER).toBeDefined()
    expect(ai.VECTOR_STORE).toBeDefined()
    expect(ai.AI_TOOL_METADATA).toBeDefined()
  })
})

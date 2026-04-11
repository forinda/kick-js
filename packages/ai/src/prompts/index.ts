/**
 * Prompt template primitives.
 *
 * Runtime-only v0 — explicit type parameter on `createPrompt` for
 * compile-time variable checking. Workstream 5 adds a typegen pass
 * that scans `createPrompt` call sites and infers the type shape
 * automatically, so users can write `createPrompt('...')` and get
 * the variable types for free. Until then, pass the type yourself:
 *
 * ```ts
 * const prompt = createPrompt<{ name: string }>('Hello {{name}}')
 * ```
 *
 * @module @forinda/kickjs-ai/prompts
 */

export { Prompt, createPrompt } from './prompt'
export type { CreatePromptOptions } from './prompt'

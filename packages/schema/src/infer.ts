import type { KickSchema } from './types.js'

/**
 * Infer the output type of any supported schema.
 *
 * Resolution order:
 * 1. KickSchema<TOutput> — reads TOutput generic
 * 2. Zod — reads `_output` (v3) or `~output` (v4) phantom type
 * 3. Standard Schema v1 — reads `~standard.types.output`
 * 4. Fallback — `unknown`
 *
 * Used by `kick typegen` to generate typed route interfaces without
 * being coupled to any specific schema library.
 */
export type InferSchemaOutput<T> =
  T extends KickSchema<infer O>
    ? O
    : T extends { '~output': infer O }
      ? O
      : T extends { _output: infer O }
        ? O
        : T extends { '~standard': { types?: { output: infer O } } }
          ? O
          : unknown

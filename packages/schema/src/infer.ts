import type { KickSchema } from './types.js'

/**
 * Infer the output type of any supported schema.
 *
 * Resolution order:
 * 1. KickSchema<TOutput> — reads TOutput generic
 * 2. Standard Schema v1 — reads `~standard.types.output` (Zod v4,
 *    Valibot, and any future Standard-Schema-compliant validator)
 * 3. Zod — reads `~output` (v4 fallback) then `_output` (v3)
 * 4. Yup — reads `__outputType` phantom
 * 5. Fallback — `unknown`
 *
 * The Standard Schema branch sits ahead of the Zod-specific branches
 * because Zod v4's `_output` is sometimes typed as `never` in object
 * schemas — falling through to `~standard` lets the call site land at
 * the real output shape without a cast.
 *
 * Used by `kick typegen` to generate typed route interfaces without
 * being coupled to any specific schema library.
 */
export type InferSchemaOutput<T> =
  T extends KickSchema<infer O>
    ? O
    : T extends { '~standard': { types?: { output: infer O } } }
      ? O
      : T extends { '~output': infer O }
        ? O
        : T extends { _output: infer O }
          ? O
          : T extends { __outputType: infer O }
            ? O
            : unknown

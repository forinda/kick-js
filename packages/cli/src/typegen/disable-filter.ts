// Pure filter for `kick.config.ts > typegen.disable`. Lives in its own
// module (instead of run-plugins.ts) so unit tests can import it
// without dragging plugin/builtins → commands/init → package.json
// reads into the test module graph.

import type { TypegenPlugin } from './plugin'

/**
 * Returns three buckets:
 *   - `enabled`: plugins that should run
 *   - `skipped`: plugins explicitly disabled by id
 *   - `unknown`: disable ids that didn't match any registered plugin
 *     — surfaced as a warning to catch typos without breaking the run
 */
export function applyDisableFilter(
  typegens: readonly TypegenPlugin[],
  disable: readonly string[],
): { enabled: TypegenPlugin[]; skipped: TypegenPlugin[]; unknown: string[] } {
  const disabledSet = new Set(disable)
  const enabled: TypegenPlugin[] = []
  const skipped: TypegenPlugin[] = []
  const matchedDisable = new Set<string>()

  for (const tg of typegens) {
    if (disabledSet.has(tg.id)) {
      skipped.push(tg)
      matchedDisable.add(tg.id)
    } else {
      enabled.push(tg)
    }
  }

  const unknown = [...disabledSet].filter((id) => !matchedDisable.has(id))
  return { enabled, skipped, unknown }
}

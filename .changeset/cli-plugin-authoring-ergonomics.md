---
'@forinda/kickjs-cli': minor
---

feat(cli): plugin generators register as Commander subcommands + `defineTypegen` helper

Two related improvements to the CLI plugin authoring surface:

**`defineTypegen` identity factory.** Mirrors the existing `defineGenerator` ergonomics — adopters can now write `defineTypegen({ id, inputs, generate })` and get full type inference on the `generate(ctx)` body without manually annotating `TypegenPlugin`. Exported alongside `defineGenerator` from `@forinda/kickjs-cli`.

**Plugin generators surface in `kick g --help` and dispatch via Commander.** Previously, `KickCliPlugin.generators[]` entries were only discoverable through `kick g --list`, and a bare invocation like `kick g drizzle-typegen` (no item arg) silently fell through to the module generator — scaffolding a module called "drizzle-typegen" instead of running the plugin. Two changes fix this:

1. `KickCliPluginContext` now carries the merged `generators[]` (threaded through by `mergeCliPlugins.register()`), so `register()` callbacks have access to plugin generators at command-registration time.
2. The built-in `kick/generate` plugin now iterates over `ctx.generators` and registers each as a real Commander subcommand. The subcommand syntax honors the spec's first `args[]` entry (`<schema>` when required, `[schema]` when optional), and declared `flags[]` show up as `--flag` options. The bare-action dispatch is preserved as a safety net for late-discovered generators (e.g. package.json-resolved entries that didn't reach `mergeCliPlugins`).

The previous `if (names.length >= 2)` gate in the bare action is gone — plugin generators dispatch via Commander whether the adopter passes 0, 1, or N positionals, with required-arg validation handled at the Commander layer.

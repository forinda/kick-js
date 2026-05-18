---
'@forinda/kickjs-cli': patch
---

fix(cli): `kick new` now emits the `.agents/` subfolder layout (was leaking the legacy flat layout)

`kick g agents` was restructured to emit `CLAUDE.md` at the project root plus `.agents/AGENTS.md` / `.agents/GEMINI.md` / `.agents/COPILOT.md` and per-skill `.agents/skills/<slug>/SKILL.md` files, but `kick new`'s project initializer had its own emission path that was never updated — so a freshly scaffolded project came out with the legacy flat layout (`AGENTS.md` + `kickjs-skills.md` at the project root) regardless of the framework version. Two paths drifted; both should produce the same shape.

The fix is one line: `initProject()` now delegates to `generateAgentDocs({ only: 'all', force: true })` instead of writing the three legacy files directly. The legacy `generateKickJsSkills` (deprecated since the per-skill split) is no longer called from the new-project path.

Regression test in `kick-new-yes.test.ts`: spawn `kick new` and assert no `AGENTS.md` / `kickjs-skills.md` at the project root; assert `.agents/AGENTS.md` / `GEMINI.md` / `COPILOT.md` exist; assert at least one `.agents/skills/<slug>/SKILL.md` (covers the per-skill format).

No CLI flag or option changes; the `kick new` surface is unchanged from the adopter's side. The fix only affects which files land where.

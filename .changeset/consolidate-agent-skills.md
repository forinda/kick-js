---
'@forinda/kickjs-cli': minor
---

Consolidate the agent skills onto one source and add a docs-lookup skill.

The skills existed twice: a structured array rendered to
`.agents/skills/<slug>/SKILL.md`, and `generateKickJsSkills()`, which restated
them by hand as one aggregate markdown file. The copy had drifted to 9 skills
against 13, and its env recipe still named a superseded API — a fix applied to
one copy silently missed the other, which is how the stale `createTestApp`
signature survived as long as it did.

`generateKickJsSkills()` turned out to have no callers at all: nothing writes
`kickjs-skills.md`, so those lines were dead as well as duplicated, which is
why nobody noticed the drift. Removed rather than rewired.

New `kickjs-docs-lookup` skill points at the online guides plus the local
tools (`kick explain`, `kick doctor`, `kick inspect`, `.kickjs/types/`, the
installed `.d.mts`) for anything the short skills do not cover. The skills
carry the traps; the docs carry the API surface. It also states the precedence
rule: when a doc page and the installed types disagree, the types win.

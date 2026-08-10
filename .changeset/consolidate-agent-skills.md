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

`AGENTS.md` is slimmed from 574 to 378 lines. Seven sections restated content
the skills already own — Testing Guidelines was a near-verbatim third copy of
the `write-controller-test` skill, and Common Pitfalls held a fourth copy of
the env story that still named a superseded API and recommended a test-isolation
approach we have since disproved. Those now point at the skill that owns the
topic. Sections with no skill equivalent — runtime neutrality, conventions,
project layout, the decorator table — are untouched.

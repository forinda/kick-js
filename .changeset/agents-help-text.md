---
'@forinda/kickjs-cli': patch
---

Fix `kick g agents` help text, which still advertised files the generator no longer writes.

`--help` (and the generator list) described the output as "AGENTS.md + CLAUDE.md +
kickjs-skills.md". Since the move to the `.agents/` layout there is no `kickjs-skills.md`:
the command writes `.agents/AGENTS.md`, `.agents/GEMINI.md`, `.agents/COPILOT.md`, one
`.agents/skills/<slug>/SKILL.md` per skill, and `CLAUDE.md` at the project root. The
`--only skills` JSDoc pointed at the same missing file.

Text only — no behaviour change.

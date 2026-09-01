---
'@forinda/kickjs-cli': patch
---

Fix two stale flag lists in `kick g` help text.

- `kick g agents --only` accepts `gemini` and `copilot`, but the option help only
  listed `agents | claude | skills | both | all`.
- `kick g agents --template` accepts `fullstack` alongside `rest` and `minimal`;
  the help omitted it, and the JSDoc still named the removed `ddd` template as
  the fallback.

Text only — no behaviour change. The matching reference tables in the guide and
API docs are corrected too, along with a `--repo` flag the scaffold docs
advertised that `kick g scaffold` never accepted.

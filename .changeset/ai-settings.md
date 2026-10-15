---
'@forinda/kickjs-ai': minor
---

New `@forinda/kickjs-ai/settings` entry: `OpenAISettings` (`OPENAI_API_KEY`, `OPENAI_BASE_URL`, …) and `AnthropicSettings` (`ANTHROPIC_*`) sections, plus `openAIFromSettings()` and `anthropicFromSettings()`. These build a provider from its section on first use. `AiAdapter` declares that section, so a missing key fails startup naming the variable, and `kick env example` lists it. Tests can supply the values with `provide()`. Use `.scoped()` for a second instance, such as Ollama. No schema library needed: the sections validate themselves, so the entry works the same in Zod, Valibot, Yup or schema-free apps. It needs a `@forinda/kickjs` with `defineSettings`; the main entry is unchanged.

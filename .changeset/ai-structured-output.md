---
'@forinda/kickjs-ai': minor
---

Structured output: `chat({ messages, schema })` answers with JSON matching `schema`, parsed and validated into `response.object`.

- **`schema`:** Zod, Valibot, Yup, any Standard Schema, or a plain JSON Schema object. A plain JSON Schema has no validator here, so its answers are only checked to be JSON. `chatObject(provider, { messages, schema })` returns just the answer, typed from the schema.
- **OpenAI and compatible endpoints (Ollama, vLLM, …):** sent as `response_format: json_schema`. `strict` is on only when OpenAI's strict mode accepts the schema (closed objects, all properties required, supported keywords and formats only); otherwise it's sent without `strict`, and the answer is still validated locally.
- **Anthropic:** sent as a forced tool call whose input is the answer. Thinking is off for that call, and combining `schema` with `tools` throws.
- **Retries:** an answer that isn't JSON or doesn't validate is sent back with what was wrong, `schemaRetries` times (default 1). After that, `StructuredOutputError` carries the `issues` and the `raw` answer. Refusals and cut-off answers aren't retried.
- **Non-object schemas** (an array, a string) travel as `{ value }` and come back unwrapped.
- **Streaming:** `schema` works with `chat()`; `stream()` refuses it.

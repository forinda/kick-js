---
'@forinda/kickjs-ai': patch
---

Memory, RAG store and prompt fixes.

- **`runAgentWithMemory`** with the default `persistToolResults: false` saved assistant tool calls without their results, a history OpenAI and Anthropic reject on the next turn. The calls are no longer saved; the assistant's text is, and empty turns are skipped.
- **`SlidingWindowChatMemory`** grew without bound (and duplicated the system prompt) at `maxMessages: 1`, and could open the history on an orphaned tool result or an assistant turn. The kept history now always starts at a user message.
- **`QdrantVectorStore`:** creating an existing collection failed after a restart — it now checks first. Non-UUID document ids (`'doc-1'`) were rejected by Qdrant; they are stored under a deterministic UUIDv5 and searches return the original id. `deleteAll` deleted the whole collection (leaving nothing to write to with `skipSetup`); it now deletes the points. Collection names are URL-encoded.
- **`PineconeVectorStore`:** a user metadata field named `content` overwrote the document text. The text is now stored under `_kick_content`; records with the text under `content` still read.
- **`PgVectorStore`:** one failed schema setup failed every later call; it is retried.
- **`RagService.augmentChatInput`:** `$&` or `` $` `` in retrieved text was read as a replacement pattern and corrupted the context.
- **Prompts:** `{{user.name}}` resolves nested values (it was reported missing); warnings go through the framework logger.
- **`AiAdapterOptions.defaults`** was ignored; it now applies to `runAgent`, per-call values winning.
- **Provider HTTP helper:** an abort during retry backoff surfaced as the retried error instead of an abort, every backoff left an abort listener behind, and breaking out of a stream early left the upstream connection open.

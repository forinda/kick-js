# AI

`@forinda/kickjs-ai` is the framework's runtime for LLM-backed
features. It brings four things to your KickJS app:

1. **Providers** — a single `AiProvider` interface with built-in
   `OpenAIProvider` and `AnthropicProvider` implementations, plus
   support for any OpenAI-compatible endpoint (Ollama, OpenRouter,
   vLLM, LocalAI, Azure OpenAI) via a `baseURL` override.
2. **Tool calling + agents** — the `@AiTool` decorator promotes any
   controller method into a model-callable function. `AiAdapter.runAgent`
   runs the full chat → tool → dispatch → feedback loop, routing each
   tool call through the normal request pipeline so middleware, auth,
   validation, and logging still apply.
3. **Memory** — a `ChatMemory` interface for multi-turn conversations,
   with `InMemoryChatMemory` for prototypes and a `SlidingWindowChatMemory`
   wrapper that caps history and pins the system prompt.
4. **RAG** — a `VectorStore` contract with four backends in the box
   (`InMemoryVectorStore`, `PgVectorStore`, `QdrantVectorStore`,
   `PineconeVectorStore`) and a `RagService` that ties them to the
   provider's embeddings for retrieval-augmented chat.

The whole package is designed so services consume DI tokens —
`AI_ADAPTER`, `AI_PROVIDER`, `VECTOR_STORE` — and swapping providers,
memory backends, or vector stores is a configuration change, not a
code change.

## Install

<PmCommand add="@forinda/kickjs-ai" />

The package depends on `@forinda/kickjs-schema` and peers on
`@forinda/kickjs`. `OpenAIProvider` talks to the upstream API over
`fetch` and needs nothing else.

Optional peers, installed only if you use the matching feature:

- `@anthropic-ai/sdk` — for `AnthropicProvider`
- `pg` — for `PgVectorStore` when you pass `connectionString` instead
  of a pre-made executor

## Wire up the adapter

Register `AiAdapter` with a provider. Environment variables flow
through the framework's `getEnv` utility so the values participate in
your Zod env schema:

```ts
import { bootstrap, getEnv } from '@forinda/kickjs'
import { AiAdapter, OpenAIProvider } from '@forinda/kickjs-ai'
import { modules } from './modules'

export const app = await bootstrap({
  modules,
  adapters: [
    AiAdapter({
      provider: new OpenAIProvider({
        apiKey: getEnv('OPENAI_API_KEY'),
        defaultChatModel: 'gpt-4o-mini',
      }),
    }),
  ],
})
```

Then inject the adapter wherever you need it:

```ts
import { Inject, Service } from '@forinda/kickjs'
import { AI_ADAPTER, type AiAdapterInstance } from '@forinda/kickjs-ai'

@Service()
export class AgentService {
  constructor(@Inject(AI_ADAPTER) private readonly ai: AiAdapterInstance) {}

  async summarize(text: string) {
    const res = await this.ai.getProvider().chat({
      messages: [
        { role: 'system', content: 'Summarize in one sentence.' },
        { role: 'user', content: text },
      ],
    })
    return res.content
  }
}
```

## Providers

### OpenAI + compatible endpoints

`OpenAIProvider` targets any OpenAI-shaped API. Override `baseURL` and
`name` to point it at Ollama, OpenRouter, vLLM, LocalAI, or an Azure
OpenAI gateway — the wire format is identical:

```ts
new OpenAIProvider({
  apiKey: getEnv('OLLAMA_API_KEY'), // usually "ollama" or empty
  baseURL: 'http://localhost:11434/v1',
  defaultChatModel: 'llama3.1',
  name: 'ollama',
})
```

### Anthropic

`AnthropicProvider` calls Claude through the official SDK. Install it
next to `@forinda/kickjs-ai` — it's an optional peer, only needed for
this provider:

<PmCommand add="@anthropic-ai/sdk" />

```ts
import { AnthropicProvider } from '@forinda/kickjs-ai'

new AnthropicProvider({
  // apiKey: omit to use ANTHROPIC_API_KEY or an `ant auth login` profile
  // defaultChatModel: 'claude-opus-5',
  effort: 'medium', // low | medium | high | xhigh | max
})
```

| Option             | Default           | Description                                                                                                                                                                    |
| ------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apiKey`           | SDK credentials   | API key; omitted, the SDK reads `ANTHROPIC_API_KEY` or an `ant auth login` profile                                                                                             |
| `client`           | —                 | A pre-configured SDK client (custom retries, or a Bedrock/Vertex client)                                                                                                       |
| `defaultChatModel` | `'claude-opus-5'` | Model when a call doesn't set one                                                                                                                                              |
| `defaultMaxTokens` | `64000`           | Cap on thinking plus response text; requests always stream, so large values are safe                                                                                           |
| `effort`           | model default     | Thinking depth and token spend; `ChatOptions.effort` overrides per call                                                                                                        |
| `thinkingDisplay`  | model default     | `'summarized'` returns a summary of the model's thinking; `'omitted'` returns none                                                                                             |
| `cache`            | `true`            | Automatic prompt caching, so agent loops re-read tools, system prompt and history from cache                                                                                   |
| `fallbacks`        | `'default'`       | On Claude Opus 5 and Fable/Mythos 5 models, a declined request is re-run on Anthropic's recommended fallback model; `false` turns it off (and must, on Bedrock/Vertex/Foundry) |

What the provider handles for you:

- **Thinking blocks** come back on `ChatResponse.providerContent`, and
  `runAgent` sends them back with the tool calls they led to — tool loops on
  thinking models need them. If you drive `chat()` yourself, copy
  `providerContent` onto the assistant message you append.
- **Refusals** set `finishReason: 'content_filter'` and `refusal` (category
  and explanation). `runAgent` stops there, and also on `'length'`, without
  running that turn's tool calls, since they may be truncated.
- **Sampling parameters** (`temperature`, `topP`) are rejected by Claude
  Opus 4.7 and later, Sonnet 5 and Fable; the provider drops them with a
  warning. Use `effort` instead.
- **Tool results** are sent back together, failed calls marked as errors.
- **Usage** includes `cacheReadTokens` and `cacheWriteTokens`.

Anthropic does not ship an embeddings API — calling `embed()` on this
provider throws a descriptive error. For RAG workflows, pair it with
`OpenAIProvider` for embeddings and keep Anthropic for chat.

### Streaming

Every provider implements `stream()` and yields `ChatChunk`s. Wire a
streaming endpoint with [Server-Sent Events](./sse.md) — `ctx.sse()`
works on every HTTP runtime, and `ctx.signal` stops the model call when
the client disconnects:

```ts
import { Controller, Get, Inject, type RequestContext } from '@forinda/kickjs'
import { AI_ADAPTER, type AiAdapterInstance, type ChatChunk } from '@forinda/kickjs-ai'

@Controller()
export class ChatController {
  constructor(@Inject(AI_ADAPTER) private readonly ai: AiAdapterInstance) {}

  @Get('/stream')
  async stream(ctx: RequestContext) {
    const sse = ctx.sse<ChatChunk>()
    const chunks = this.ai
      .getProvider()
      .stream(
        { messages: [{ role: 'user', content: String(ctx.query.q ?? '') }] },
        { signal: ctx.signal },
      )
    for await (const chunk of chunks) {
      sse.send(chunk)
      if (chunk.done) break
    }
    sse.close()
  }
}
```

## Tools + agent loop

The `@AiTool` decorator promotes a controller method into a
model-callable function. `AiAdapter.runAgent` drives the chat → tool
dispatch → feedback loop automatically.

```ts
import { z } from 'zod'
import { Controller, Post, type RequestContext } from '@forinda/kickjs'
import { AiTool } from '@forinda/kickjs-ai'

@Controller()
export class TaskController {
  @Post('/')
  @AiTool({
    name: 'create_task',
    description: 'Create a new task with a title and optional priority',
    inputSchema: z.object({
      title: z.string().describe('Short task title'),
      priority: z.enum(['low', 'medium', 'high']).optional(),
    }),
  })
  async create(ctx: RequestContext) {
    const { title, priority = 'medium' } = ctx.body as {
      title: string
      priority?: string
    }
    const task = await this.taskService.create({ title, priority })
    return ctx.created(task)
  }
}
```

Run an agent:

```ts
const result = await this.ai.runAgent({
  messages: [
    { role: 'system', content: 'You create tasks for the team.' },
    { role: 'user', content: 'Add a high-priority task to ship the release' },
  ],
  tools: 'auto', // use every @AiTool in the registry
  maxSteps: 5,
})

console.log(result.content) // final assistant text
console.log(result.messages) // full transcript, including tool calls and results
console.log(result.finishReason) // why the last turn stopped
```

Tool calls run through the app's own pipeline (`AdapterContext.fetch`),
so middleware, validation, auth guards, and logging all run exactly the
same way they do for external callers — without a listening server, so
agents also work under `createHandler()` and in tests.

Tool routes see only the headers you pass. To call them as the user who
started the agent, forward their credentials; `signal` also aborts
in-flight tool calls:

```ts
@Post('/assistant')
async ask(ctx: RequestContext) {
  const result = await this.ai.runAgent({
    messages: [{ role: 'user', content: ctx.body.question }],
    headers: { authorization: ctx.headers.authorization ?? '' },
    signal: ctx.signal,
  })
  ctx.json({ answer: result.content })
}
```

### Exposing tools with route flags

[Route flags](./route-flags.md) expose or hide tools without `@AiTool`
on every method — on a controller, a method, or a module mount:

```ts
import { defineRouteFlag } from '@forinda/kickjs'
import { AiAdapter, type AiToolOptions } from '@forinda/kickjs-ai'

export const Tool = defineRouteFlag<Partial<AiToolOptions>>('ai.tool')

AiAdapter({
  provider,
  exposeWhen: 'ai.tool', // routes carrying it become tools
  hideWhen: 'ai.hidden', // routes carrying it never do
})

@Tool({ description: 'Look up orders' })
@Controller()
export class OrdersController {}

// Hide a controller you don't own:
routes: () => ({ path: '/admin', controller: AdminController, flags: ['ai.hidden'] })
```

Both options take the same forms as `skipWhen` (a name, `'!name'`, a
list, or a predicate). An object flag value supplies `description` and
`name`; `@AiTool` on the method takes precedence, and `hideWhen` wins
over both.

## Memory

`ChatMemory` is the contract for multi-turn conversation persistence.
Every backend implements the same interface, so swapping from an
in-memory `Map` to a database is a one-line DI change.

```ts
import { InMemoryChatMemory, SlidingWindowChatMemory } from '@forinda/kickjs-ai'

const memory = new SlidingWindowChatMemory({
  inner: new InMemoryChatMemory(),
  maxMessages: 20,
  pinSystemPrompt: true,
})

const result = await this.ai.runAgentWithMemory({
  memory,
  userMessage: 'What did I just ask you?',
  systemPrompt: 'You are a helpful assistant.',
  tools: 'auto',
})
```

`runAgentWithMemory` handles the boilerplate for you:

- First turn: persists the system prompt + user message before calling
  the model. On follow-up turns, the system prompt is ignored so the
  model sees a single stable persona.
- After each turn: appends the assistant reply. Tool results are
  dropped from memory by default (they're usually large API
  responses), and so are the tool calls that led to them — a call
  saved without its result is a history providers reject. The
  assistant's text is kept. Set `persistToolResults: true` for
  full-transcript replay.
- `SlidingWindowChatMemory` keeps the most recent `maxMessages`
  messages. A pinned first system message stays put so the model
  never loses its persona. The kept history always starts at a user
  message, so it never opens on a tool result whose call was evicted —
  the window can hold slightly fewer messages than the cap.

For multi-tenant apps, construct one memory instance per session —
typically in a request-scoped factory or keyed by a `sessionId`
parameter on the backend.

## Prompts

`createPrompt` is a tiny template engine for building reusable prompts
with typed variables:

```ts
import { createPrompt } from '@forinda/kickjs-ai'

const summaryPrompt = createPrompt<{ topic: string; tone: string }>(
  'Write a {{tone}} summary about {{topic}}.',
  { name: 'summary', role: 'system' },
)

const message = summaryPrompt.render({ topic: 'CPU caches', tone: 'friendly' })
// → { role: 'system', content: 'Write a friendly summary about CPU caches.' }
```

- Variables must be strings (or anything that stringifies).
- Missing variables throw by default; pass `onMissing: 'warn'` or
  `'silent'` to leave the placeholder in place instead.
- `getPlaceholders()` returns the names defined in the template — useful
  for schema introspection or UI validation.

## RAG

Retrieval-augmented generation has two pieces: a `VectorStore` for
embeddings and a `RagService` that ties the store to a provider.

### Pick a vector store

```ts
import {
  InMemoryVectorStore,
  PgVectorStore,
  QdrantVectorStore,
  PineconeVectorStore,
} from '@forinda/kickjs-ai'
```

| Backend    | When to use                                                       |
| ---------- | ----------------------------------------------------------------- |
| `InMemory` | Prototypes, tests, CLI tools, corpora under ~10k docs             |
| `Pg`       | Any app that already runs Postgres 13+; enables the pgvector ext  |
| `Qdrant`   | Dedicated vector DB, self-hosted or managed, rich payload filters |
| `Pinecone` | Fully managed, multi-region, namespace-based multi-tenancy        |

Every backend implements the same `VectorStore<M>` interface:
`upsert`, `query`, `delete`, `deleteAll`, optional `count`. Services
that consume `VECTOR_STORE` never need to know which one is wired in.

Backend notes:

- **Qdrant** point ids must be UUIDs or integers, so any other document
  id (`'doc-1'`) is stored under a deterministic UUIDv5 and kept in the
  payload; searches return your original id. The collection is created
  on first use only if it doesn't exist, and `deleteAll` removes points
  but keeps the collection.
- **Pinecone** metadata is flat, so the document text is stored under the
  reserved `_kick_content` key next to your metadata; a metadata field
  named `content` is yours. Records written before this layout, with the
  text under `content`, still read correctly.
- **pgvector** retries its schema setup on the next call if it fails.

```ts
import { bootstrap, getEnv } from '@forinda/kickjs'
import { AiAdapter, OpenAIProvider, QdrantVectorStore, VECTOR_STORE } from '@forinda/kickjs-ai'

const store = new QdrantVectorStore({
  url: getEnv('QDRANT_URL'),
  apiKey: getEnv('QDRANT_API_KEY'),
  collection: 'docs',
  dimensions: 1536, // must match the embedding model
})

export const app = await bootstrap({
  modules,
  adapters: [
    AiAdapter({
      provider: new OpenAIProvider({ apiKey: getEnv('OPENAI_API_KEY') }),
    }),
  ],
  plugins: [
    {
      name: 'vector-store',
      register: (container) => {
        container.registerInstance(VECTOR_STORE, store)
      },
    },
  ],
})
```

### Index and query with `RagService`

```ts
import { Inject, Service } from '@forinda/kickjs'
import {
  AI_PROVIDER,
  RagService,
  VECTOR_STORE,
  type AiProvider,
  type VectorStore,
} from '@forinda/kickjs-ai'

@Service()
export class KnowledgeService {
  private readonly rag: RagService

  constructor(@Inject(AI_PROVIDER) provider: AiProvider, @Inject(VECTOR_STORE) store: VectorStore) {
    this.rag = new RagService(provider, store)
  }

  async index(docs: Array<{ id: string; content: string }>) {
    await this.rag.index(docs)
  }

  async ask(question: string) {
    const input = await this.rag.augmentChatInput(
      { messages: [{ role: 'user', content: question }] },
      question,
      { topK: 4 },
    )
    const res = await this.rag.getProvider().chat(input)
    return res.content
  }
}
```

`augmentChatInput` retrieves the top-K most similar documents,
concatenates them into a system message, and returns a new
`ChatInput` you can hand straight to `provider.chat`. By default it
merges the context into the first existing system message (to avoid
competing personas); pass `asSeparateSystemMessage: true` to prepend a
separate one instead.

### Filtering

Every backend supports equality-map filters:

```ts
await rag.search('how does auth work', {
  topK: 5,
  filter: { tenant: 'acme', tag: ['auth', 'security'] },
})
```

- Scalar values become exact-match conditions.
- Arrays become `IN`-style conditions.
- Qdrant and Pinecone both support richer native DSLs (range, `$or`,
  `$not`) — pass them through the same `filter` field and the
  translator keeps operator records untouched.

## Using other OpenAI-compatible providers

Because `OpenAIProvider` only assumes the wire format, any endpoint
that speaks `/chat/completions` works out of the box. Common
configurations:

```ts
// Ollama (local)
new OpenAIProvider({
  apiKey: 'ollama',
  baseURL: 'http://localhost:11434/v1',
  defaultChatModel: 'llama3.1',
  name: 'ollama',
})

// OpenRouter
new OpenAIProvider({
  apiKey: getEnv('OPENROUTER_API_KEY'),
  baseURL: 'https://openrouter.ai/api/v1',
  defaultChatModel: 'anthropic/claude-3.5-sonnet',
  name: 'openrouter',
})

// vLLM
new OpenAIProvider({
  apiKey: 'vllm',
  baseURL: 'http://vllm.internal:8000/v1',
  defaultChatModel: 'meta-llama/Llama-3.1-70B-Instruct',
  name: 'vllm',
})
```

The `name` override is optional but helpful — it shows up in logs and
debug UIs so you can tell at a glance which endpoint is being hit.

## Testing

The `ScriptedProvider` pattern keeps tests deterministic without
touching a real API. Implement `AiProvider` with a queue of canned
responses and assert on what the adapter sent:

```ts
class ScriptedProvider implements AiProvider {
  readonly name = 'scripted'
  public inputs: ChatInput[] = []
  private queue: ChatResponse[]

  constructor(responses: ChatResponse[]) {
    this.queue = [...responses]
  }

  async chat(input: ChatInput): Promise<ChatResponse> {
    this.inputs.push({ ...input, messages: [...input.messages] })
    return this.queue.shift()!
  }

  async *stream() {
    throw new Error('not used')
  }

  async embed(): Promise<number[][]> {
    throw new Error('not used')
  }
}
```

Deep-copy the captured inputs — the agent loop mutates its messages
array between calls, so a stored reference would drift away from the
state the provider actually saw.

## Next steps

- [MCP adapter](./mcp) — expose controller routes to external Model
  Context Protocol clients with `@McpTool`; a route can carry both
  decorators
- [Dependency Injection](./dependency-injection) — how `AiAdapter`
  and `VECTOR_STORE` bindings flow through the container
- [Plugins](./plugins) — the canonical place to wire DI bindings at
  startup

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
   tool call through the normal Express pipeline so middleware, auth,
   validation, and logging still apply.
3. **Memory** — a `ChatMemory` interface for multi-turn conversations,
   with `InMemoryChatMemory` for prototypes and a `SlidingWindowChatMemory`
   wrapper that caps history and pins the system prompt.
4. **RAG** — a `VectorStore` contract with four backends in the box
   (`InMemoryVectorStore`, `PgVectorStore`, `QdrantVectorStore`,
   `PineconeVectorStore`) and a `RagService` that ties them to the
   provider's embeddings for retrieval-augmented chat.

The whole package is designed so services consume one DI token —
`AiAdapter` — and swapping providers, memory backends, or vector
stores is a configuration change, not a code change.

## Install

```bash
pnpm add @forinda/kickjs-ai
```

The package declares `@forinda/kickjs` and `reflect-metadata` as
dependencies and `zod` as a peer. No other runtime is required for
the built-in providers — they talk to upstream APIs over `fetch`.

Optional peers, installed only if you use the matching backend:

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
import { Service, Autowired } from '@forinda/kickjs'
import { AiAdapter } from '@forinda/kickjs-ai'

@Service()
export class AgentService {
  @Autowired() private readonly ai!: AiAdapter

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

`AnthropicProvider` targets Anthropic's Messages API. It translates
the framework's normalized chat shape into content blocks, extracts
system messages into the top-level `system` field, and handles
`tool_use` / `tool_result` wire formats transparently.

```ts
import { AnthropicProvider } from '@forinda/kickjs-ai'

new AnthropicProvider({
  apiKey: getEnv('ANTHROPIC_API_KEY'),
  defaultChatModel: 'claude-opus-4-6',
  // defaultMaxTokens: 4096  (Anthropic requires max_tokens on every call)
})
```

Anthropic does not ship an embeddings API — calling `embed()` on this
provider throws a descriptive error. For RAG workflows, pair it with
`OpenAIProvider` for embeddings and keep Anthropic for chat.

### Streaming

Every provider implements `stream()` and yields `ChatChunk`s. Wire a
streaming endpoint with Server-Sent Events:

```ts
import { Controller, Get, type RequestContext } from '@forinda/kickjs'
import { Autowired } from '@forinda/kickjs'
import { AiAdapter } from '@forinda/kickjs-ai'

@Controller()
export class ChatController {
  @Autowired() private readonly ai!: AiAdapter

  @Get('/stream')
  async stream(ctx: RequestContext) {
    ctx.res.setHeader('content-type', 'text/event-stream')
    for await (const chunk of this.ai.getProvider().stream({
      messages: [{ role: 'user', content: String(ctx.query.q ?? '') }],
    })) {
      ctx.res.write(`data: ${JSON.stringify(chunk)}\n\n`)
      if (chunk.done) break
    }
    ctx.res.end()
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

console.log(result.content)    // final assistant text
console.log(result.toolCalls)  // audit trail of what was called
```

Tool dispatch happens through internal HTTP requests against the
running KickJS server, so middleware, validation, auth guards, and
logging all run exactly the same way they do for external callers.

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
  responses) — set `persistToolResults: true` for full-transcript
  replay.
- `SlidingWindowChatMemory` evicts the oldest non-system messages
  when the cap is hit. The pinned system message stays put so the
  model never loses its persona.

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

```ts
import { bootstrap, getEnv } from '@forinda/kickjs'
import {
  AiAdapter,
  OpenAIProvider,
  QdrantVectorStore,
  VECTOR_STORE,
} from '@forinda/kickjs-ai'

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
import { Service, Autowired, Inject } from '@forinda/kickjs'
import { RagService, VECTOR_STORE, type VectorStore } from '@forinda/kickjs-ai'
import { AiAdapter } from '@forinda/kickjs-ai'

@Service()
export class KnowledgeService {
  private readonly rag: RagService

  constructor(
    @Autowired() ai: AiAdapter,
    @Inject(VECTOR_STORE) store: VectorStore,
  ) {
    this.rag = new RagService({ provider: ai.getProvider(), store })
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

- [MCP adapter](./mcp) — expose the same `@AiTool` methods to external
  Model Context Protocol clients
- [Dependency Injection](./dependency-injection) — how `AiAdapter`
  and `VECTOR_STORE` bindings flow through the container
- [Plugins](./plugins) — the canonical place to wire DI bindings at
  startup

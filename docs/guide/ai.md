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

Transient failures (429, 5xx) are retried three times with backoff. Set
`retry: { maxRetries, baseDelayMs, maxDelayMs }` to tune it, or
`{ maxRetries: 0 }` to turn it off. A `Retry-After` longer than
`maxDelayMs` (default 30s) isn't waited out; the `ProviderError` is
thrown so you can decide.

### Anthropic

`AnthropicProvider` calls Claude through the official SDK. Install it
next to `@forinda/kickjs-ai` — it's an optional peer, only needed for
this provider:

<PmCommand add="@anthropic-ai/sdk" />

```ts
import { AnthropicProvider } from '@forinda/kickjs-ai'

new AnthropicProvider({
  // apiKey: omit to use ANTHROPIC_API_KEY or an `ant auth login` profile
  // defaultChatModel: 'claude-opus-5-5',
  effort: 'medium', // low | medium | high | xhigh | max
})
```

| Option             | Default             | Description                                                                                                                                                                    |
| ------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apiKey`           | SDK credentials     | API key; omitted, the SDK reads `ANTHROPIC_API_KEY` or an `ant auth login` profile                                                                                             |
| `client`           | —                   | A pre-configured SDK client (custom retries, or a Bedrock/Vertex client)                                                                                                       |
| `defaultChatModel` | `'claude-opus-5-5'` | Model when a call doesn't set one                                                                                                                                              |
| `defaultMaxTokens` | `64000`             | Cap on thinking plus response text; requests always stream, so large values are safe                                                                                           |
| `effort`           | model default       | Thinking depth and token spend; `ChatOptions.effort` overrides per call                                                                                                        |
| `thinkingDisplay`  | model default       | `'summarized'` returns a summary of the model's thinking; `'omitted'` returns none                                                                                             |
| `cache`            | `true`              | Automatic prompt caching, so agent loops re-read tools, system prompt and history from cache                                                                                   |
| `fallbacks`        | `'default'`         | On Claude Opus 5 and Fable/Mythos 5 models, a declined request is re-run on Anthropic's recommended fallback model; `false` turns it off (and must, on Bedrock/Vertex/Foundry) |

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

### Your own `fetch`

Both providers take a `fetch` option that sends every request in place of
the global `fetch` — for a proxy or custom TLS, tracing model calls, adding
headers for an API gateway, or a runtime without a global `fetch`. Retries
and streaming go through it too:

```ts
import { Agent, fetch as undiciFetch } from 'undici'

const dispatcher = new Agent({ connect: { ca: corporateCa } })

new OpenAIProvider({
  apiKey: getEnv('OPENAI_API_KEY'),
  fetch: (url, init) => undiciFetch(url, { ...init, dispatcher }) as unknown as Promise<Response>,
})

new AnthropicProvider({
  fetch: async (url, init) => {
    const started = performance.now()
    const res = await fetch(url, init)
    log.debug('anthropic', { status: res.status, ms: performance.now() - started })
    return res
  },
})
```

Without it, the global `fetch` is used, looked up on every call. `AnthropicProvider`
passes `fetch` to the SDK client it creates; if you pass your own `client`,
give that client its `fetch` instead.

### Custom providers

Any model can back the adapter: implement `AiProvider` and pass it to
`AiAdapter`, or mount it next to the default with `registerProvider`.
The contract is small:

| Member                   | What to return                                                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                   | An identifier, e.g. `'in-house'`                                                                                                                                       |
| `chat(input, options)`   | A `ChatResponse`: `content`, `toolCalls` when the model calls tools, and a normalized `finishReason` — `'stop'`, `'length'`, `'tool_call'` or `'content_filter'`       |
| `stream(input, options)` | `ChatChunk`s: text in `content`, tool calls as `toolCallDelta` (`id`, `index`, `name`, then `argumentsDelta`), and a final chunk with `done: true` plus `finishReason` |
| `embed(input)`           | One vector per input string, in input order — or throw if the model has no embeddings                                                                                  |

- `input.tools` is always an array of `ChatToolDefinition` (`name`,
  `description`, JSON Schema `inputSchema`) when tools are offered;
  `runAgent` resolves `'auto'` before calling you.
- Tool results arrive as `role: 'tool'` messages with `toolCallId`, and
  `isError` when the call failed.
- If your model needs its own content sent back on the next turn (thinking
  or signed blocks), return it as `providerContent`; `runAgent` copies it
  onto the assistant message you receive next time.
- Honour `options.signal`, and throw `ProviderError(status, body)` for
  failed HTTP calls so callers can read the status.

This local provider uses only those primitives — no network, no model. It
routes a message to a tool by keyword, answers with the tool's result, and
embeds text with a hashed bag-of-words vector, so it also works for offline
development, tests, and RAG:

```ts
import type {
  AiProvider,
  ChatChunk,
  ChatInput,
  ChatOptions,
  ChatResponse,
  EmbedInput,
} from '@forinda/kickjs-ai'

interface KeywordRule {
  /** When the latest user message matches, call this tool. */
  match: RegExp
  tool: string
  /** Build the tool arguments from the message. */
  args?: (message: string) => Record<string, unknown>
}

/**
 * A local, deterministic provider: routes a user message to a tool by
 * keyword, answers with the tool result, and embeds text with a hashed
 * bag-of-words vector. No network, no model — useful offline, in tests, or
 * as the starting point for wrapping an in-house model.
 */
class KeywordProvider implements AiProvider {
  readonly name = 'keywords'

  constructor(
    private readonly rules: KeywordRule[],
    private readonly dimensions = 64,
  ) {}

  async chat(input: ChatInput, options: ChatOptions = {}): Promise<ChatResponse> {
    options.signal?.throwIfAborted()
    const last = input.messages.at(-1)

    // A tool just ran: answer with its result and finish the loop.
    if (last?.role === 'tool') {
      return { content: `Here is what I found: ${last.content}`, finishReason: 'stop' }
    }

    const text = last?.content ?? ''
    // Only offer tools the caller made available on this call.
    const available = new Set((Array.isArray(input.tools) ? input.tools : []).map((t) => t.name))
    const rule = this.rules.find((r) => available.has(r.tool) && r.match.test(text))
    if (!rule) {
      return { content: "I don't have a tool for that.", finishReason: 'stop' }
    }
    return {
      content: '',
      toolCalls: [
        { id: `call_${crypto.randomUUID()}`, name: rule.tool, arguments: rule.args?.(text) ?? {} },
      ],
      finishReason: 'tool_call',
    }
  }

  async *stream(input: ChatInput, options: ChatOptions = {}): AsyncIterable<ChatChunk> {
    const response = await this.chat(input, options)
    if (response.content) yield { content: response.content, done: false }
    // Each tool call streams as a start delta, then one arguments delta.
    for (const [index, call] of (response.toolCalls ?? []).entries()) {
      yield { content: '', done: false, toolCallDelta: { id: call.id, index, name: call.name } }
      yield {
        content: '',
        done: false,
        toolCallDelta: { id: call.id, index, argumentsDelta: JSON.stringify(call.arguments) },
      }
    }
    yield { content: '', done: true, finishReason: response.finishReason }
  }

  async embed(input: EmbedInput): Promise<number[][]> {
    const texts = Array.isArray(input) ? input : [input]
    return texts.map((text) => {
      const vector = Array.from({ length: this.dimensions }, () => 0)
      for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
        let hash = 0
        for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
        vector[hash % this.dimensions] += 1
      }
      const length = Math.hypot(...vector) || 1
      return vector.map((value) => value / length)
    })
  }
}
```

Mount it later — from a plugin or module — and pick it per call:

```ts
const ai = container.resolve(AI_ADAPTER)

ai.registerProvider(
  'orders-bot',
  new KeywordProvider([
    {
      match: /order\s+#?(\w+)/i,
      tool: 'get_order',
      args: (message) => ({ id: /order\s+#?(\w+)/i.exec(message)![1] }),
    },
  ]),
)

const result = await ai.runAgent({
  provider: 'orders-bot', // a registered name, or a provider instance
  messages: [{ role: 'user', content: 'Where is order #A42?' }],
})
// result.content → 'Here is what I found: {"id":"A42","status":"shipped"}'

const rag = new RagService(ai.getProvider('orders-bot'), new InMemoryVectorStore())
```

- The provider the adapter was created with is the default, under its
  `name`; `getProvider()` returns it and `AI_PROVIDER` resolves to it. Its
  name can't be reused, and it can't be unregistered.
- Registering an existing name replaces that provider, so a plugin can
  register again after a hot reload. `unregisterProvider(name)` removes one.
- `runAgentWithMemory` takes the same `provider` option.

The example is exercised as a test in
`packages/ai/__tests__/example-local-provider.test.ts`.

### Several adapters

Registered providers share one adapter: the same tools, the same
`exposeWhen` / `hideWhen` rules, the same defaults. When two parts of an app
need different ones — a support bot that may open tickets, a billing bot that
may refund — mount the adapter more than once with `.scoped(name, options)`.
Each instance registers under its own tokens and is injected separately:

```ts
import { Inject, Service, bootstrap } from '@forinda/kickjs'
import {
  AiAdapter,
  AnthropicProvider,
  OpenAIProvider,
  aiAdapterToken,
  type AiAdapterInstance,
} from '@forinda/kickjs-ai'

bootstrap({
  modules,
  adapters: [
    AiAdapter.scoped('support', {
      provider: new AnthropicProvider(),
      hideWhen: ['billing'], // routes mounted with the `billing` flag aren't its tools
    }),
    AiAdapter.scoped('billing', {
      provider: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! }),
      exposeWhen: ['billing'],
    }),
  ],
})

@Service()
export class SupportBot {
  constructor(@Inject(aiAdapterToken('support')) private readonly ai: AiAdapterInstance) {}
}
```

- `aiAdapterToken(scope)` resolves a scoped adapter, `aiProviderToken(scope)`
  its default provider. The same scope always gives the same token.
- `AI_ADAPTER` and `AI_PROVIDER` belong to the unscoped adapter only. Mount one
  next to scoped ones if code injects those; with only scoped adapters, they
  aren't registered.
- Each instance has its own provider registry, tools and defaults:
  `registerProvider` on one doesn't reach another.
- `@AiTool` methods are exposed by every instance unless its `hideWhen` hides
  them; `exposeWhen` adds flagged routes on top.

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

### Files and images

Some flows start with a file: read an uploaded invoice, describe a
screenshot, answer questions about a CSV export. Put files on a `user`
message's `attachments`. `content` stays the text of the message, so existing
code and stored histories are unchanged:

```ts
import { Controller, FileUpload, Inject, Post, type RequestContext } from '@forinda/kickjs'
import { AI_ADAPTER, attachmentFromFile, type AiAdapterInstance } from '@forinda/kickjs-ai'

@Controller()
export class InvoiceController {
  constructor(@Inject(AI_ADAPTER) private readonly ai: AiAdapterInstance) {}

  @Post('/invoices/read')
  @FileUpload({ mode: 'single', fieldName: 'invoice' })
  async read(ctx: RequestContext) {
    const res = await this.ai.getProvider().chat({
      messages: [
        {
          role: 'user',
          content: 'List the line items as JSON.',
          attachments: [attachmentFromFile(ctx.file!)],
        },
      ],
    })
    ctx.json({ items: res.content })
  }
}
```

An attachment is a content part in the shape other AI SDKs use, so parts
built elsewhere work here as they are:

```ts
type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; data: Uint8Array | string; mimeType: string }
  | { type: 'file'; data: Uint8Array | string; mimeType: string; filename?: string }
```

`data` is raw bytes, base64, a `data:` URL, or an `http(s)://` URL. Files go
ahead of the message's text, which is where models read them best.

#### What is sent, by default

What a file is comes from its **bytes**, not the MIME type it arrived with —
browsers disagree (a Windows `.csv` arrives as `application/vnd.ms-excel`):

| The bytes are                                                           | Anthropic                               | OpenAI                            |
| ----------------------------------------------------------------------- | --------------------------------------- | --------------------------------- |
| PNG, JPEG, GIF or WebP                                                  | image block                             | `image_url` (data URL)            |
| a PDF                                                                   | document block — text and page images   | `file` part                       |
| valid UTF-8 — CSV, TSV, JSON, Markdown, XML, YAML, SQL, logs, code, SVG | text document titled with the file name | text part headed by the file name |
| anything else — xlsx, docx, pptx, zip, audio, video                     | throws, naming the file                 | throws, naming the file           |

URLs have no bytes to inspect, so `mimeType` decides: an image or PDF URL is
passed to the provider to fetch. Anything else by URL throws — fetch it and
send the contents.

Limitations of the default handling:

- **Office files, archives, audio and video aren't read.** Neither provider
  takes them inline. Convert them to text first (below).
- **Text is read as UTF-8 unless the upload says otherwise.** A file that
  declares a charset (`text/csv; charset=windows-1252`, `utf-16le`) is decoded
  as that. One in another encoding that declares nothing — a Latin-1 CSV from
  an old spreadsheet — isn't valid UTF-8, so it's refused rather than garbled;
  decode it in `normalize`.
- **Text is sent as text, not parsed.** A 50,000-row CSV becomes 50,000 rows
  of prompt — it costs tokens and may not fit the model's context. Summarise
  or sample large files first.
- **Only images and PDFs can be sent by URL**, and OpenAI's Chat Completions
  can't fetch a PDF by URL at all.
- **Provider limits still apply** — file size, PDF page count, images per
  request. Exceeding them is a provider error (`ProviderError`), not a
  framework one.
- **Attachments only go on `user` messages**; a provider throws for any other
  role.
- **Memory keeps them.** With `runAgentWithMemory()` the file is stored with
  the message and sent again every turn — summarise a large file once rather
  than keeping it in history.

#### Converting other formats

The framework doesn't bundle converters: which library, which sheet, which
parts of a document matter is the app's call. Pass `normalize` to
`attachmentFromFile`. It runs only for files the default doesn't read, and
returns text, a content part, or `undefined` to refuse the file:

```ts
import * as XLSX from 'xlsx' // SheetJS
import mammoth from 'mammoth'

const part = attachmentFromFile(ctx.file!, {
  normalize: (file) => {
    if (file.originalname?.endsWith('.xlsx')) {
      const book = XLSX.read(file.buffer)
      // Every sheet as CSV, headed by its name.
      return book.SheetNames.map(
        (name) => `# ${name}\n${XLSX.utils.sheet_to_csv(book.Sheets[name]!)}`,
      ).join('\n\n')
    }
    return undefined // anything else: refuse it, with the default error
  },
})
```

`mammoth` is asynchronous, so convert a Word document before building the part:

```ts
import mammoth from 'mammoth'
import { attachmentFromFile, type ContentPart } from '@forinda/kickjs-ai'

const file = ctx.file!
const attachments: ContentPart[] = []

if (file.originalname.endsWith('.docx')) {
  const { value: text } = await mammoth.extractRawText({ buffer: file.buffer })
  attachments.push({
    type: 'file',
    data: Buffer.from(text),
    mimeType: 'text/plain',
    filename: file.originalname,
  })
} else {
  attachments.push(attachmentFromFile(file))
}

const res = await this.ai.getProvider().chat({
  messages: [{ role: 'user', content: 'Summarise this document.', attachments }],
})
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

- First turn: sends the system prompt with the user message. On
  follow-up turns, the system prompt is ignored so the model sees a
  single stable persona.
- It takes every `runAgent` option (`effort`, `tools`, `headers`, …).
- Nothing is saved until the turn succeeds. Then the user message and
  the assistant reply are appended together, so a failed call never
  leaves an unanswered message in the history. Tool results are
  dropped from memory by default (they're usually large API
  responses), and so are the tool calls that led to them — a call
  saved without its result is a history providers reject. The
  assistant's text is kept. Set `persistToolResults: true` for
  full-transcript replay.
- `SlidingWindowChatMemory` keeps the most recent `maxMessages`
  messages, and runs its writes one at a time so concurrent turns can't
  drop each other's messages. A pinned first system message stays put so the model
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

`index` embeds `batchSize` documents per provider call (default 100),
so a large corpus stays under the provider's input limits:
`rag.index(docs, { batchSize: 50 })`.

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
- Pinecone also takes its native operators (`$gt`, `$ne`, `$or`, …):
  a filter whose keys start with `$`, or a value that is an operator
  record, passes through unchanged.
- Qdrant, pgvector and the in-memory store take equality and `IN` only. For
  ranges or negation, query the store directly.

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

`ScriptedProvider` answers each call with the next scripted turn, so tests
run without a real API. It records every input and its options:

```ts
import { ScriptedProvider } from '@forinda/kickjs-ai'

const provider = new ScriptedProvider([
  { content: '', toolCalls: [{ id: 'c1', name: 'TasksController_list', arguments: {} }] },
  { content: 'You have 2 tasks.', finishReason: 'stop' },
])

const result = await ai.runAgent({ provider, messages: [{ role: 'user', content: 'tasks?' }] })

expect(result.content).toBe('You have 2 tasks.')
expect(provider.inputs[1].messages.at(-1)).toMatchObject({ role: 'tool' })
```

- A turn can be a function of the input: `(input) => ({ content: ... })`.
- `stream()` replays the next turn as chunks. `embed()` needs an `embed`
  option, `new ScriptedProvider([], { embed: (texts) => texts.map(() => [1, 0]) })`,
  which is enough for `RagService` tests.
- `provider.remaining` is the count of unused turns. A call past the end
  throws, so a loop that runs too long fails the test.

## Next steps

- [MCP adapter](./mcp) — expose controller routes to external Model
  Context Protocol clients with `@McpTool`; a route can carry both
  decorators
- [Dependency Injection](./dependency-injection) — how `AiAdapter`
  and `VECTOR_STORE` bindings flow through the container
- [Plugins](./plugins) — the canonical place to wire DI bindings at
  startup

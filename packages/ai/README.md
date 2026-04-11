# @forinda/kickjs-ai

AI runtime for KickJS. Provides a provider abstraction, an `@AiTool` decorator for turning controller endpoints into LLM tool calls, streaming response helpers, RAG primitives, and an agent loop executor — all built on the framework's existing DI container and Zod validation.

## Status

**v0 — skeleton.** The provider interface, DI token, adapter skeleton, and `@AiTool` decorator exist and compile. Built-in providers (OpenAI, Anthropic, Google, Ollama), streaming, RAG, and the agent loop are scheduled for subsequent phases of Workstream 2 in the v3 AI plan.

### Roadmap

- **Phase A** — Provider interface + OpenAI and Anthropic implementations (`chat`, `stream`, `embed`)
- **Phase B** — `@AiTool` decorator with runtime dispatch via the Express pipeline
- **Phase C** — RAG primitives + pgvector/Qdrant/Pinecone vector stores
- **Phase D** — Agent loop executor with request-scoped memory + prompt templates

## Install

```bash
pnpm add @forinda/kickjs-ai
```

Zod is a peer dependency (already installed in every KickJS project).

## Usage (planned — phase A)

```ts
import { bootstrap } from '@forinda/kickjs'
import { AiAdapter } from '@forinda/kickjs-ai'
import { OpenAIProvider } from '@forinda/kickjs-ai/providers/openai'
import { modules } from './modules'

export const app = await bootstrap({
  modules,
  adapters: [
    new AiAdapter({
      provider: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! }),
    }),
  ],
})
```

Inject the provider in any service:

```ts
import { Service, Inject } from '@forinda/kickjs'
import { AI_PROVIDER, type AiProvider } from '@forinda/kickjs-ai'

@Service()
export class SummarizeService {
  constructor(@Inject(AI_PROVIDER) private readonly ai: AiProvider) {}

  async summarize(text: string): Promise<string> {
    const res = await this.ai.chat({
      messages: [
        { role: 'system', content: 'Summarize the following in 2 sentences.' },
        { role: 'user', content: text },
      ],
    })
    return res.content
  }
}
```

## `@AiTool` — endpoints as tool calls (planned — phase B)

The feature that makes this package unique. Because Zod schemas already power route validation, they also power tool definitions — no duplicated type declarations:

```ts
import { Controller, Post, type Ctx } from '@forinda/kickjs'
import { AiTool } from '@forinda/kickjs-ai'
import { createTaskSchema } from './dtos/create-task.dto'

@Controller('/tasks')
export class TaskController {
  @Post('/', { body: createTaskSchema, name: 'CreateTask' })
  @AiTool({ description: 'Create a new task with title, priority, and optional assignee' })
  create(ctx: Ctx<KickRoutes.TaskController['create']>) {
    return this.createTaskUseCase.execute(ctx.body)
  }
}
```

At runtime, `ai.chat({ tools: 'auto' })` exposes every `@AiTool`-decorated method to the model. Tool calls route back through the normal Express pipeline, so auth, validation, and logging all still apply.

## License

MIT

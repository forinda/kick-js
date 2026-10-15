# @forinda/kickjs-ai

AI runtime for KickJS — provider bindings (OpenAI, Anthropic, OpenAI-compatible), `@AiTool` decorator that turns controllers into model-callable tools, agent loop, chat memory, and RAG (in-memory / pgvector / Qdrant / Pinecone).

## Install

```bash
kick add ai
```

## Quick Example

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

Or let the package read and validate its own variables (`OPENAI_API_KEY`,
`OPENAI_BASE_URL`, `OPENAI_DEFAULT_CHAT_MODEL`, … — `ANTHROPIC_*` for Claude).
A missing key fails startup by name, and `kick env example` lists them:

```ts
import { AiAdapter } from '@forinda/kickjs-ai'
import { openAIFromSettings } from '@forinda/kickjs-ai/settings'

export const app = await bootstrap({
  modules,
  adapters: [AiAdapter({ provider: openAIFromSettings() })],
})
```

Then in any service:

```ts
import { Inject, Service } from '@forinda/kickjs'
import { AI_ADAPTER, type AiAdapterInstance } from '@forinda/kickjs-ai'

@Service()
class AgentService {
  constructor(@Inject(AI_ADAPTER) private ai: AiAdapterInstance) {}

  async ask(prompt: string) {
    const result = await this.ai.runAgent({
      messages: [{ role: 'user', content: prompt }],
      tools: 'auto',
    })
    return result.content
  }
}
```

## Documentation

[kickjs.app/guide/ai](https://kickjs.app/guide/ai) — providers, provider config from env, `@AiTool`, agent loops, memory, RAG.

## License

MIT

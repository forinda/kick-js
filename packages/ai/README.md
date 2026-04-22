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

[forinda.github.io/kick-js/guide/ai](https://forinda.github.io/kick-js/guide/ai) — providers, `@AiTool`, agent loops, memory, RAG.

## License

MIT

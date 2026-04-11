import { Logger, type AppAdapter, type AdapterContext, Scope } from '@forinda/kickjs'
import { AI_PROVIDER } from './constants'
import type { AiAdapterOptions, AiProvider } from './types'

const log = Logger.for('AiAdapter')

/**
 * Register an AI provider in the DI container and make it injectable
 * via `@Inject(AI_PROVIDER)`.
 *
 * The adapter is deliberately minimal: it owns the provider lifecycle
 * and nothing else. Tool discovery (`@AiTool`), streaming helpers, RAG,
 * and agent loops live in their own files and compose on top of this.
 *
 * @example
 * ```ts
 * import { bootstrap } from '@forinda/kickjs'
 * import { AiAdapter } from '@forinda/kickjs-ai'
 * import { OpenAIProvider } from './openai-provider'
 * import { modules } from './modules'
 *
 * export const app = await bootstrap({
 *   modules,
 *   adapters: [
 *     new AiAdapter({
 *       provider: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! }),
 *     }),
 *   ],
 * })
 * ```
 *
 * @remarks
 * This is a v0 skeleton. Built-in providers (OpenAI, Anthropic, Google,
 * Ollama), the `@AiTool` runtime dispatch, streaming response helpers,
 * and the agent loop are not implemented yet — this package is part of
 * Workstream 2 of the v3 AI plan. The current adapter registers the
 * provider and logs its name; the rest comes in subsequent PRs.
 */
export class AiAdapter implements AppAdapter {
  readonly name = 'AiAdapter'

  private readonly provider: AiProvider

  constructor(options: AiAdapterOptions) {
    this.provider = options.provider
  }

  /**
   * Register the provider in the DI container so services can inject it.
   *
   * Runs during the `beforeStart` phase so every `@Service()` resolved
   * afterwards sees the token bound to the concrete provider.
   */
  beforeStart({ container }: AdapterContext): void {
    container.registerFactory(AI_PROVIDER, () => this.provider, Scope.SINGLETON)
    log.info(`AiAdapter ready — provider: ${this.provider.name}`)
  }

  /**
   * Tear down the provider, releasing HTTP connections or shared state.
   *
   * Providers are not required to implement any teardown, so this is a
   * best-effort call. Anything the provider throws during shutdown is
   * logged but does not abort the framework's shutdown sequence.
   */
  async shutdown(): Promise<void> {
    // TODO: Call a provider.close?.() hook once the AiProvider interface
    // grows one. For now, providers are stateless HTTP clients that don't
    // need explicit cleanup.
    log.debug('AiAdapter shutdown complete')
  }
}

/**
 * Public entry for `@forinda/kickjs-devtools-kit`. Plugins/adapters
 * import from here to integrate with KickJS DevTools without pulling
 * in the runtime / UI surface.
 *
 * @module @forinda/kickjs-devtools-kit
 */

export {
  PROTOCOL_VERSION,
  defineDevtoolsTab,
  type DevtoolsTabDescriptor,
  type DevtoolsTabView,
  type IntrospectFn,
  type IntrospectionKind,
  type IntrospectionSnapshot,
  type MemoryHealth,
  type RpcError,
  type RpcFailure,
  type RpcRequest,
  type RpcResponse,
  type RpcSuccess,
  type RuntimeSnapshot,
  type TopologyContributorEntry,
  type TopologyError,
  type TopologySnapshot,
  type TopologyTokenEntry,
} from './types'

// M2.C — render-based tab contract. Coexists with the legacy
// descriptor surface above; tabs migrate one at a time.
export {
  defineDevtoolsRenderTab,
  type DevtoolsRenderTab,
  type TabProps,
  type TabRuntimeConfig,
} from './tab'
export type { KickEventBus, KickDevtoolsEventName, Unsubscribe } from './bus/types'

export { RuntimeSampler, type RuntimeSamplerOptions } from './runtime-sampler'

export {
  MemoryAnalyzer,
  heapGrowthBytesPerSec,
  type MemoryAnalyzerOptions,
} from './memory-analyzer'

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
} from './types'

export { RuntimeSampler, type RuntimeSamplerOptions } from './runtime-sampler'

export {
  MemoryAnalyzer,
  heapGrowthBytesPerSec,
  type MemoryAnalyzerOptions,
} from './memory-analyzer'

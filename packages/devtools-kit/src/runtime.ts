/**
 * Runtime sub-entry — re-exports the sampler + analyzer for callers
 * that only want the monitoring primitives without the full kit's type
 * surface. DevTools' runtime package imports from here.
 *
 * @module @forinda/kickjs-devtools-kit/runtime
 */

export { RuntimeSampler, type RuntimeSamplerOptions } from './runtime-sampler'
export {
  MemoryAnalyzer,
  heapGrowthBytesPerSec,
  type MemoryAnalyzerOptions,
} from './memory-analyzer'

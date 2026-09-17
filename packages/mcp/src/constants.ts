import { createToken } from '@forinda/kickjs'
import type { McpAdapterExtensions } from './mcp.adapter'
import type { McpToolOptions } from './types'

/**
 * Metadata key for the `@McpTool` decorator.
 *
 * Using `createToken` (rather than a raw `Symbol` or bare string) gives
 * a collision-safe, type-carrying identifier: the phantom type parameter
 * flows through `getMethodMetaOrUndefined` so consumers get
 * `McpToolOptions` back without a manual cast, and the reserved `kick/`
 * prefix prevents two separate definitions of `MCP_TOOL_METADATA` from
 * shadowing each other even if the package is loaded more than once.
 */
export const MCP_TOOL_METADATA = createToken<McpToolOptions>('kick/mcp/tool')

/**
 * DI token for the McpAdapter instance, registered during startup. Resolve
 * it from a plugin or module to mount custom tools with `registerProvider`.
 */
export const MCP_ADAPTER = createToken<McpAdapterExtensions>('kick/mcp/adapter')

import { createToken } from '@forinda/kickjs'
import type { McpToolOptions } from './types'

/**
 * Metadata key for the `@McpTool` decorator.
 *
 * Using `createToken` gives a collision-safe, type-carrying identifier:
 * the phantom type parameter flows through `getMethodMetaOrUndefined`
 * so consumers get `McpToolOptions` back without a manual cast, and
 * reference-equality guarantees that two separate definitions of
 * `MCP_TOOL_METADATA` can never shadow each other even if the package
 * is loaded more than once.
 */
export const MCP_TOOL_METADATA = createToken<McpToolOptions>('kickjs.mcp.tool')

import { setMethodMeta, getMethodMetaOrUndefined } from '@forinda/kickjs'
import { MCP_TOOL_METADATA } from './constants'
import type { McpToolOptions } from './types'

/**
 * Mark a controller method as an MCP tool.
 *
 * The adapter scans for this decorator at startup and registers the
 * method as a callable tool on the MCP server. The input schema is
 * inferred from the route's `body` Zod schema — you don't repeat it here.
 *
 * @example
 * ```ts
 * import { Controller, Post, type Ctx } from '@forinda/kickjs'
 * import { McpTool } from '@forinda/kickjs-mcp'
 * import { createTaskSchema } from './dtos/create-task.dto'
 *
 * @Controller()
 * export class TaskController {
 *   @Post('/', { body: createTaskSchema, name: 'CreateTask' })
 *   @McpTool({ description: 'Create a new task' })
 *   create(ctx: Ctx<KickRoutes.TaskController['create']>) {
 *     // ... existing handler ...
 *   }
 * }
 * ```
 *
 * In `explicit` mode (the default), only methods with this decorator
 * are exposed as tools. In `auto` mode, it still controls the human-
 * readable description and examples shown to the model.
 */
export function McpTool(options: McpToolOptions): MethodDecorator {
  return (target, propertyKey) => {
    setMethodMeta(MCP_TOOL_METADATA, options, target, propertyKey as string)
  }
}

/**
 * Read the MCP tool metadata attached to a method, if any.
 *
 * Returns `undefined` if the method was not decorated with `@McpTool`.
 * The adapter uses this during the startup scan to decide whether a
 * route should be registered as a tool.
 */
export function getMcpToolMeta(target: object, method: string): McpToolOptions | undefined {
  return getMethodMetaOrUndefined<McpToolOptions>(MCP_TOOL_METADATA, target, method)
}

/** Check whether a method was decorated with `@McpTool`. */
export function isMcpTool(target: object, method: string): boolean {
  return getMcpToolMeta(target, method) !== undefined
}

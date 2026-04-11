import { setMethodMeta, getMethodMetaOrUndefined } from '@forinda/kickjs'
import { AI_TOOL_METADATA } from './constants'
import type { AiToolOptions } from './types'

/**
 * Mark a controller method as an AI-callable tool.
 *
 * At startup, the `AiAdapter` scans all `@Controller` classes in the
 * DI container for this decorator and builds a tool registry. When a
 * service calls `ai.chat({ ..., tools: 'auto' })`, the framework
 * passes the registered tools to the provider, the model may call
 * them, and the framework dispatches back through the normal Express
 * pipeline — so tool calls go through auth, validation, and logging
 * just like external HTTP requests.
 *
 * The input schema is derived from the route's `body` Zod schema:
 *
 * @example
 * ```ts
 * import { Controller, Post, type Ctx } from '@forinda/kickjs'
 * import { AiTool } from '@forinda/kickjs-ai'
 * import { createTaskSchema } from './dtos/create-task.dto'
 *
 * @Controller('/tasks')
 * export class TaskController {
 *   @Post('/', { body: createTaskSchema, name: 'CreateTask' })
 *   @AiTool({ description: 'Create a new task' })
 *   create(ctx: Ctx<KickRoutes.TaskController['create']>) {
 *     return this.createTaskUseCase.execute(ctx.body)
 *   }
 * }
 * ```
 */
export function AiTool(options: AiToolOptions): MethodDecorator {
  return (target, propertyKey) => {
    setMethodMeta(AI_TOOL_METADATA, options, target, propertyKey as string)
  }
}

/** Read the AI tool metadata attached to a method, if any. */
export function getAiToolMeta(target: object, method: string): AiToolOptions | undefined {
  return getMethodMetaOrUndefined<AiToolOptions>(AI_TOOL_METADATA, target, method)
}

/** Check whether a method was decorated with `@AiTool`. */
export function isAiTool(target: object, method: string): boolean {
  return getAiToolMeta(target, method) !== undefined
}

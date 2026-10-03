/**
 * Throw from a custom tool's handler to return an error the model can act
 * on: the result is `isError: true`, with `{ error: { code, message, ...data } }`
 * as its `structuredContent` and the message as text.
 *
 * @example
 * ```ts
 * throw new McpToolError('approval_pending', 'Waiting for a manager', { approvalId })
 * throw new McpToolError('rate_limited', 'Too many requests', { retryAfter: 30 })
 * ```
 */
export class McpToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly data: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'McpToolError'
  }
}

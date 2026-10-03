type Contents = { uri: string; mimeType?: string; text?: string; blob?: string }

/** A resource read's return value as MCP `resources/read` contents. */
export function toReadResult(
  uri: string,
  mimeType: string | undefined,
  result: unknown,
): { contents: Contents[] } {
  if (
    result &&
    typeof result === 'object' &&
    Array.isArray((result as { contents?: unknown }).contents)
  ) {
    return result as { contents: Contents[] }
  }
  if (typeof result === 'string') {
    return { contents: [{ uri, mimeType: mimeType ?? 'text/plain', text: result }] }
  }
  if (result instanceof Uint8Array) {
    return {
      contents: [
        {
          uri,
          mimeType: mimeType ?? 'application/octet-stream',
          blob: Buffer.from(result).toString('base64'),
        },
      ],
    }
  }
  return {
    contents: [
      { uri, mimeType: mimeType ?? 'application/json', text: JSON.stringify(result ?? null) },
    ],
  }
}

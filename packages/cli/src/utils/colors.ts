import pc from 'picocolors'

export { pc as colors }

const METHOD_COLOR_MAP: Record<string, (s: string) => string> = {
  GET: pc.green,
  POST: pc.cyan,
  PUT: pc.yellow,
  PATCH: pc.magenta,
  DELETE: pc.red,
}

/** Color an HTTP method string for terminal display */
export function httpMethodColor(method: string): string {
  const fn = METHOD_COLOR_MAP[method] ?? pc.dim
  return fn(method.padEnd(7))
}

/** Color a severity tag for terminal display */
export function severityColor(severity: string): string {
  switch (severity) {
    case 'CRITICAL':
      return pc.red(`[CRITICAL]`)
    case 'WARNING':
      return pc.yellow(`[WARNING] `)
    case 'INFO':
      return pc.blue(pc.dim(`[INFO]    `))
    default:
      return `[${severity}]`
  }
}

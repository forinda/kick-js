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

/** Color a severity tag for terminal display (padded to 10 chars) */
export function severityColor(severity: string): string {
  const tag = `[${severity}]`.padEnd(10)
  switch (severity) {
    case 'CRITICAL':
      return pc.red(tag)
    case 'WARNING':
      return pc.yellow(tag)
    case 'INFO':
      return pc.blue(pc.dim(tag))
    default:
      return tag
  }
}

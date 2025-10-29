/**
 * Normalizes a route path by ensuring it starts with a `'/'` and does not end with a `'/'`.
 * @param {any} path
 * @returns {string}
 */
export function normalizeRoutePath(path: any): string {
  if (typeof path !== "string") {
    throw new Error("Invalid path type");
  }
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  if (path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  return path;
}

/**
 * Combine base path and route path into a full path
 * @param {string} basePath
 * @param {string} routePath
 * @returns {string}
 */
export function combineRoutePaths(basePath: string, routePath: string): string {
  const base = basePath === "" ? "" : basePath.replace(/\/$/, "");
  const route = routePath === "" ? "" : routePath;
  const full = `${base}${route}`;
  return normalizeRoutePath(full === "" ? "/" : full);
}

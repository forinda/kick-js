/** Escape a string for safe HTML attribute/content interpolation */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Generate Swagger UI HTML using local assets from swagger-ui-dist.
 *
 * Assets are served from `/_swagger-assets/` by the adapter's Express
 * static middleware. Falls back to CDN if the local path is not provided.
 * This ensures Swagger UI works fully offline in development.
 *
 * @param specUrl - Path to the OpenAPI JSON spec (e.g., '/openapi.json')
 * @param title - Page title
 * @param assetsPath - Base path for local swagger-ui-dist assets (e.g., '/_swagger-assets')
 */
export function swaggerUIHtml(specUrl: string, title = 'API Docs', assetsPath?: string): string {
  const safeTitle = escapeHtml(title)
  // JSON-stringify for safe inlining into the `<script>` block. The inline
  // script below resolves this to an absolute URL against
  // `window.location.origin` before passing it to SwaggerUIBundle —
  // some swagger-ui-dist builds call `new URL(url)` without a base and
  // crash with `Failed to construct 'URL': Invalid URL` when the value
  // is a bare path like `/openapi.json`.
  const safeUrl = JSON.stringify(specUrl).replace(/</g, '\\u003c')

  // Use local assets if available, CDN as fallback
  const cssHref = assetsPath
    ? `${assetsPath}/swagger-ui.css`
    : 'https://unpkg.com/swagger-ui-dist@5/swagger-ui.css'
  const bundleSrc = assetsPath
    ? `${assetsPath}/swagger-ui-bundle.js`
    : 'https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js'
  const presetSrc = assetsPath
    ? `${assetsPath}/swagger-ui-standalone-preset.js`
    : 'https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js'

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  <link rel="stylesheet" href="${cssHref}">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${bundleSrc}"></script>
  <script src="${presetSrc}"></script>
  <script>
    (function () {
      var rawUrl = ${safeUrl};
      var specUrl;
      try {
        specUrl = new URL(rawUrl, window.location.origin).href;
      } catch (_e) {
        specUrl = rawUrl;
      }
      SwaggerUIBundle({
        url: specUrl,
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        plugins: [SwaggerUIBundle.plugins.DownloadUrl],
        layout: 'StandaloneLayout',
      });
    })();
  </script>
</body>
</html>`
}

/**
 * Generate ReDoc HTML.
 *
 * ReDoc doesn't publish a standalone npm package suitable for local serving,
 * so it still loads from CDN. If offline support for ReDoc is needed,
 * vendor the standalone bundle into the package's public/ directory.
 */
export function redocHtml(specUrl: string, title = 'API Docs'): string {
  const safeTitle = escapeHtml(title)
  const safeUrl = escapeHtml(specUrl)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
</head>
<body>
  <redoc spec-url="${safeUrl}"></redoc>
  <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
</body>
</html>`
}

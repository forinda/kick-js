/** Escape a string for safe HTML attribute/content interpolation */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Generate Swagger UI HTML that loads from CDN */
export function swaggerUIHtml(specUrl: string, title = 'API Docs'): string {
  const safeTitle = escapeHtml(title)
  const safeUrl = JSON.stringify(specUrl)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
  <script>
    SwaggerUIBundle({
      url: ${safeUrl},
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
      plugins: [SwaggerUIBundle.plugins.DownloadUrl],
      layout: 'StandaloneLayout',
    });
  </script>
</body>
</html>`
}

/** Generate ReDoc HTML that loads from CDN */
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

// Turn a built docs site into redirect stubs for the GitHub Pages mirror.
//
// kickjs.app (Netlify) is the docs' home. The old copy on
// forinda.github.io/kick-js is still what search engines index, and Pages
// can't send a 301, so every page there becomes an instant meta refresh plus a
// canonical link to the same page on kickjs.app, which crawlers treat as a
// permanent redirect. Unknown paths land on 404.html, which forwards the path.
//
//   node scripts/docs-pages-redirects.mjs <built dist> <out dir>
import { copyFileSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

const [dist, out] = process.argv.slice(2)
if (!dist || !out) throw new Error('usage: docs-pages-redirects.mjs <dist> <out>')
const HOST = 'https://kickjs.app/'

const pages = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      // The hashed JS/CSS bundle only served the pages, which are stubs now.
      if (p !== join(dist, 'assets')) walk(p)
    } else if (name.endsWith('.html')) {
      if (name !== '404.html') pages.push(p)
    } else {
      // Images, llms.txt and the like: a meta refresh can't redirect them,
      // so keep serving them where outside links expect them.
      const file = join(out, relative(dist, p))
      mkdirSync(dirname(file), { recursive: true })
      copyFileSync(p, file)
    }
  }
}
walk(dist)

const stub = (url) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Moved to kickjs.app</title>
<link rel="canonical" href="${url}">
<meta http-equiv="refresh" content="0; url=${url}">
</head>
<body><p>The KickJS docs moved to <a href="${url}">${url}</a>.</p></body>
</html>
`

for (const page of pages) {
  const rel = relative(dist, page).split(sep).join('/')
  // Same paths the sitemap and canonical links use: a directory index is its folder.
  const url = HOST + rel.replace(/(^|\/)index\.html$/, '$1')
  const file = join(out, rel)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, stub(url))
}

// Pages serves this for any path it has no file for; keep the path, drop the
// /kick-js project prefix.
writeFileSync(
  join(out, '404.html'),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Moved to kickjs.app</title>
<meta name="robots" content="noindex">
<script>location.replace('${HOST}' + location.pathname.replace(/^\\/kick-js\\/?/, '') + location.search + location.hash)</script>
</head>
<body><p>The KickJS docs moved to <a href="${HOST}">${HOST}</a>.</p></body>
</html>
`,
)
writeFileSync(join(out, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${HOST}sitemap.xml\n`)

console.log(`${pages.length} redirect stubs written to ${out}`)

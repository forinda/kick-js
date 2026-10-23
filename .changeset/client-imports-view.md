---
'@forinda/kickjs-view': minor
---

Client scripts can import. A bundle's `client` map (`entries` by component tag, `files` with entries and shared chunks) is served from `clientScriptPath`, and a page's tag points at the component's entry. Served file names may now be bundler names (`<name>.<hash>.js`, letters, digits, `_` and `-`). The checker no longer refuses imports. Without a bundler (plain Node, no `kick dev`), a script that imports fails at render with `client scripts that import need kick dev or a kick build`; self-contained scripts work as before. The bundle's `client.css` (stylesheets by component tag) is linked in the page's `<head>` when the component renders, and `.css` files are served as `text/css`. Under `kick dev`, scripts aren't type-stripped by the server (Vite does it), and the import check ignores comments and strings.

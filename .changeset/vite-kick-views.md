---
'@forinda/kickjs-vite': minor
---

`virtual:kick-views`, for `.kick` templates. `kick build` checks every template and ships them in the build, and a broken template fails the build. In dev, templates are read from disk and the pipes file loads through Vite. Pass `views: false` to `kickjsVitePlugin` to leave it out.

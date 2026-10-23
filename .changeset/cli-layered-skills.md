---
'@forinda/kickjs-cli': minor
---

`kick add views` (and `kick new --packages views`) sets an app up for `.kick` templates: it installs `@forinda/kickjs-view`, writes `src/views.ts`, `src/adapters/views.ts`, a layout and a `home` page, and adds `viewsAdapter()` to the entry file. `kick new` also registers `viewCliPlugin` in `kick.config.ts`; `kick add` prints that line.

Agent skills now follow the app's features. `kick g agents` writes the general skills plus those of the features whose packages are in `package.json` (the views skills for an app using `@forinda/kickjs-view`). `kick add <feature>` writes that feature's skills when `.agents/skills/` exists, never over one already there. The general skills read the same as before.

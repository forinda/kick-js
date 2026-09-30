---
'@forinda/kickjs-devtools': patch
---

The dashboard now stores its access token in a cookie scoped to the devtools base path (for example `/_debug`) instead of `path=/`. At `path=/` the browser sent the devtools secret with every request to the app, so any request logger or handler could see it. The root-path cookie written by earlier versions is removed the next time the dashboard loads.

---
'@forinda/kickjs-view': minor
---

`<style>{{ css | raw }}</style>` prints trusted CSS, for inlining a stylesheet into a PDF or an email. It must be the element's whole content, it's refused inside SVG, and the render fails if the CSS contains `</style`. Any other `{{ }}` inside `<style>` is still a compile error.

---
'@forinda/kickjs-vite': patch
---

Pages served by Vite load their dependencies pre-bundled again. The plugin turned dependency discovery off for every environment, so in an Inertia app each file of a package like `@tabler/icons-react` loaded as its own request (thousands per page). The server environment keeps Vite's default, discovery off.

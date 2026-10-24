---
'@forinda/kickjs-devtools': patch
---

DevTools Routes tab: "Expand all" / "Collapse all" looks only at the controller groups on screen, so a remembered group that's filtered out or no longer exists doesn't make it offer "Expand all" with nothing to expand.

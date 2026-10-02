---
'@forinda/kickjs': patch
---

`ctx.download(buffer, filename)` writes the file name per RFC 6266: an ASCII fallback plus `filename*=UTF-8''…`. The name went into `Content-Disposition` raw, so a name taken from an upload could break the header — a `"` cut it short, a line break made Node throw — and non-Latin names were mangled.

---
'@forinda/kickjs': patch
---

Fixes to HTTPS / HTTP/2 serving, from review:

- **h3 uploads over HTTP/2:** a multipart upload sent without `content-length` lost every file and field. The h3 runtime now reads a length-less HTTP/2 body once, as bytes, and hands it to h3 on `req.rawBody`. That covers both uploads and JSON/text bodies, and file bytes are never decoded as text.
- **Incomplete TLS credentials fail at boot with KICK009.** Before, Node started an HTTPS / HTTP/2 server with a key but no cert (or no identity at all, or a key that doesn't match its cert), and every TLS handshake then failed. The check accepts `key` + `cert`, `pfx`, `SNICallback` or `pskCallback`. It also builds the secure context once, so unreadable PEMs and key/cert mismatches are caught too.
- **Shutdown closes open HTTP/2 sessions.** `server.close()` stops new sessions, but on Node 22 and earlier existing sessions kept accepting new requests, even after `shutdown()` returned. Shutdown now closes every session gracefully (in-flight streams finish, new ones are refused) and destroys any that remain if the shutdown timeout is reached.

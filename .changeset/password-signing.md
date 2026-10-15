---
'@forinda/kickjs': minor
---

Adds `hashPassword` and `verifyPassword`, plus `createSigner` for signed tokens. All three are Node only.

- **Password hashes:** scrypt with a self-describing `scrypt$N$r$p$salt$hash` format. The default cost is OWASP's 2^14/8/5 setting.
- **`verifyPassword` results:** it returns `{ ok, needsRehash }`, so stored hashes move to a new cost as users log in. Passing `undefined` for a missing user still spends the full hashing time, so response times don't reveal which accounts exist. A foreign or hostile hash fails rather than throws, and memory is capped at 256 MiB per hash.
- **Signed tokens:** `createSigner({ secret, salt })` makes URL-safe tokens with an issue time. They're for reset and confirmation links.
  - `verify(token, { maxAge })` returns `{ ok, value, issuedAt }` or `{ ok: false, reason: 'invalid' | 'expired' }`.
  - A secret list rotates keys.
  - The salt separates purposes.

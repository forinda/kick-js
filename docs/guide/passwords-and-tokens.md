---
description: Hash passwords with scrypt and upgrade them on login, and sign tokens for reset and confirmation links with expiry, key rotation and per-purpose salts.
---

# Passwords and Signed Tokens

Two primitives that [bring-your-own auth](./authentication.md) builds on. Both live in `@forinda/kickjs` and are Node only (they use `node:crypto`).

## Passwords: `hashPassword` / `verifyPassword`

```ts
import { HttpException, hashPassword, verifyPassword } from '@forinda/kickjs'

// Sign-up
await users.create({ email, passwordHash: await hashPassword(password) })

// Login
const user = await users.findByEmail(email)
const { ok, needsRehash } = await verifyPassword(password, user?.passwordHash)
if (!ok) throw HttpException.unauthorized('Invalid email or password')
if (needsRehash) {
  await users.update(user!.id, { passwordHash: await hashPassword(password) })
}
```

**scrypt, salted, self-describing.** A hash looks like `scrypt$16384$8$5$<salt>$<hash>`: it records its own cost, so stored hashes keep verifying after you change the defaults. The same password hashes differently every time.

**Upgrade on login.** `needsRehash` is true when a password matched but its hash was made with a different cost than you passed (or the defaults). Hash it again and store it, and accounts move to the new cost as people sign in. It is only ever true when `ok` is, so it can't be used to upgrade a wrong password.

**Pass `undefined` for a missing user.** `verifyPassword(password, user?.passwordHash)` still runs the hash when there's no user, at the cost you pass, so "no such account" takes as long as "wrong password" and response times don't reveal which emails are registered. Return the same message for both.

**Never throws on bad input.** A hash in another format (bcrypt from a previous system, a corrupt column) returns `{ ok: false }`. So does a hash whose cost would need more than 256 MiB, so a tampered row can't exhaust memory.

**Normalised.** Passwords are NFKC-normalised before hashing (NIST 800-63B's advice), so `café` typed with a composed or a decomposed accent is the same password.

### Cost

The default, `{ N: 2 ** 14, r: 8, p: 5 }`, is one of OWASP's recommended scrypt settings: 16 MiB and roughly 50–100 ms per hash on a server CPU. To raise it, pass the same options to both functions:

```ts
const cost = { N: 2 ** 15, r: 8, p: 5 }
await hashPassword(password, cost)
await verifyPassword(password, stored, cost) // needsRehash: true for hashes made at 2^14
```

While accounts are moving to a new cost, those still on the old one verify at the old speed. That's a timing difference, but it reveals an account's age, not whether it exists. Memory is `128 * N * r` bytes per concurrent hash. Mind it on small containers, and in tests pass a low cost (`{ N: 2 ** 10, r: 8, p: 1 }`) to keep them fast.

## Signed tokens: `createSigner`

For links you send and check later without storing them: password reset, email confirmation, unsubscribe, a magic login link.

```ts
import { HttpException, createSigner, getEnv } from '@forinda/kickjs'

const resets = createSigner({ secret: getEnv('SIGNING_SECRET'), salt: 'password-reset' })

// Issue
const token = resets.sign({ userId: user.id, stamp: user.passwordChangedAt })
await mailer.send(user.email, `https://app.example.com/reset?token=${token}`)

// Redeem
const check = resets.verify<{ userId: string; stamp: string }>(token, { maxAge: 60 * 60_000 })
if (!check.ok) throw HttpException.badRequest(check.reason) // 'invalid' | 'expired'
const user = await users.find(check.value.userId)
if (user.passwordChangedAt !== check.value.stamp) throw HttpException.badRequest('used')
```

- **Signed, not encrypted.** The token is `payload.timestamp.signature`, URL-safe, and anyone holding it can decode the payload. Put ids in it, not secrets.
- **`salt` names the purpose.** Signers with different salts reject each other's tokens even with the same secret, so an unsubscribe token can never be redeemed as a password reset.
- **`maxAge`** is in milliseconds, checked at `verify()`. `check.issuedAt` gives the issue time if you need your own rule.
- **One-time use is yours.** A signature can't be revoked. To make a link single-use, sign something that changes when it is used, like the user's password-change time above, and compare it on redeem.
- **`verify()` never throws.** It returns `{ ok: false, reason }` for tampered, malformed or expired tokens.

### Rotating the secret

Pass a list, newest first. The first secret signs, and every secret verifies:

```ts
createSigner({
  secret: [getEnv('SIGNING_SECRET'), getEnv('SIGNING_SECRET_OLD')],
  salt: 'password-reset',
})
```

Remove the old secret once the longest `maxAge` has passed. Sessions rotate the same way: see [`session({ secret: [...] })`](./sessions.md).

## See also

- [Authentication](./authentication.md): where these fit in a login flow
- [Sessions](./sessions.md): signed cookies with secret rotation
- [Configuration](./configuration.md#secrets-from-files): reading `SIGNING_SECRET` from a mounted file

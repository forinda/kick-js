---
'@forinda/kickjs-cli': minor
---

Let `typegen.client` take `{ maxDepth }` to tune client-map expansion depth.

A response type is expanded inline up to 12 levels before it is emitted as
`unknown`. That limit was hardcoded, so a project whose types were genuinely
deeper had no way to recover the lost fidelity — the only ceiling in the map an
adopter could not lift.

```ts
typegen: {
  client: {
    maxDepth: 24
  }
}
```

The object form is on unless it says otherwise, so `{ maxDepth: 24 }` alone also
enables the map; `{ enabled: false }` disables it. `client: true` is unchanged.

The default is rarely reached: recursive and named types both hoist into their
own interface, which costs one level rather than the whole budget, so only deep
anonymous nesting spends it. On a 1,940-route app the emitted map is
byte-identical at 12, 24, 48 and 96 — the knob exists for the project where it
is not, not because the default is wrong.

The depth is part of the map's fingerprint, so changing it rebuilds rather than
serving the cached map.

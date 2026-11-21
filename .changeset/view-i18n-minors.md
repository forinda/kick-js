---
'@forinda/kickjs-view': patch
---

Translation and pipe follow-ups:

- A plural message needs `count` (`t:'count':n`) even when its text doesn't show `{count}`; the check now says so.
- `nl2br` in an attribute is a warning: the `<br>` it makes shows as text there.
- `plural` and `ago` reuse their `Intl` objects instead of building them on every call.
- A dev render reads the message catalogues once, not several times; missing-key warnings are printed in dev only.
- `@forinda/kickjs-cli-kit` is a dependency, so `@forinda/kickjs-view/cli`'s types resolve without `skipLibCheck`.
- Builds need `@forinda/kickjs-vite` from the same release: an older plugin doesn't know the new pipes and doesn't bundle `messages`.

# Translations

<!-- {{ }} below is template syntax, not VitePress interpolation -->

:::: v-pre

Put one JSON file per locale in `src/views/locales/`, and print messages with the `t` pipe.

```
src/views/locales/
  en.json
  sw.json
```

```json
{
  "cart": {
    "title": "Your cart",
    "items": { "zero": "Your cart is empty", "one": "{count} item", "other": "{count} items" },
    "greeting": "Hello {name}"
  }
}
```

```kick
<h1>{{ 'cart.title' | t }}</h1>
<p>{{ 'cart.items' | t:'count':cart.items.length }}</p>
<p>{{ 'cart.greeting' | t:'name':user.name }}</p>
<button title="{{ 'cart.title' | t }}">…</button>
```

- **Keys** are the JSON's nested names joined with dots: `cart.title`.
- **Parameters** follow `t` as name/value pairs, as with `kvQuery`: `t:'count':n:'name':user.name`. A message names them in braces: `{count}`. Numbers are formatted for the locale (`1,024`).
- **Plurals:** a message can be an object of plural forms (`zero`, `one`, `two`, `few`, `many`, `other`; `other` is required). The `count` parameter picks the form, by the language's plural rules. `zero` is used for `0` when it's there.
- **Escaping:** messages and their parameters are escaped, like any `{{ }}`. Messages can't contain HTML.

## Which locale

A render uses the `locale` it's given: `ctx.render(name, data, { locale: user.locale })`, else `createViews({ locale })`, else `en-US`. A message is looked up in that locale (`sw-KE`), then its language (`sw`), then the default locale (`messagesLocale`, else `locale`) and its language. A key no catalogue has prints as the key itself, with a warning.

## Checked by the build

`kick check:views`, the Vite build and `kick dev` check every `t` call whose key is written in the template:

- a key no catalogue has is an error: `unknown message 'cart.nope'`;
- a key some catalogues lack is a warning naming the locales;
- a `{placeholder}` the call doesn't pass is an error: `message 'cart.items' needs 'count'`;
- parameters that aren't name/value pairs are an error.

A key computed at render time (`{{ item.labelKey | t }}`) isn't checked. The editor doesn't show these checks yet.

## Outside templates

`views.t` gives controllers, emails and flash messages the same messages:

```ts
const subject = await views.t('mail.welcome.subject', { name: user.name }, { locale: user.locale })
```

## Where catalogues come from

- **`kick dev` and file mode:** read from `<viewsDir>/locales/*.json`; edits show on the next render.
- **A Vite build:** bundled into `virtual:kick-views` as `messages`, so `createViews({ ...kickViews })` needs no file system (the edge works too).
- **Your own:** `createViews({ messages: { en: { 'cart.title': 'Cart' } } })`.

## Using another i18n library

Export your own `t` from `pipes.ts` and it replaces the built-in one. The build then leaves your `t` calls unchecked:

```ts
// src/views/pipes.ts
import i18next from 'i18next'
import { withEnv } from '@forinda/kickjs-view'

export const t = withEnv(({ locale }) => (key: string, ...pairs: unknown[]) => {
  const params: Record<string, unknown> = {}
  for (let i = 0; i + 1 < pairs.length; i += 2) params[String(pairs[i])] = pairs[i + 1]
  return i18next.t(key, { lng: locale, ...params })
})
```

::::

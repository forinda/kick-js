# Forms

<!-- {{ }} below is template syntax, not VitePress interpolation -->

:::: v-pre

A form post that fails validation goes back to the form with each field's error and what was typed, and a controller can leave a message for the next page:

```ts
// src/index.ts
import { bootstrap, formErrorHandler, session } from '@forinda/kickjs'
import express from 'express'

export const app = await bootstrap({
  modules,
  middlewares: [
    // Express only: listing `middlewares` replaces the default pipeline, body
    // parsers included, and forms post urlencoded. Fastify and h3 parse bodies themselves.
    express.urlencoded({ extended: false }),
    session({ secret: env.SESSION_SECRET, store: 'cookie' }),
  ],
  adapters: [KickView({ views })],
  onError: formErrorHandler(), // with Inertia: formErrorHandler(inertiaErrorHandler())
})
```

```ts
import { flash } from '@forinda/kickjs'

@Post('/products', { body: createProductSchema })
async create(ctx: RequestContext) {
  await this.products.create(ctx.body)
  flash(ctx, { success: 'Product saved' })
  ctx.redirect('/products')
}
```

```kick
@if ($flash.success) {
  <p class="notice">{{ $flash.success }}</p>
}
<form method="post" action="/products">
  <input name="title">
  @error('title') {
    <b class="field-error">{{ $message }}</b>
  }
  <textarea name="description"></textarea>
  <button>Save</button>
</form>
```

- **Going back.** When route validation fails on a browser form submit (urlencoded or multipart, asking for HTML, not an Inertia visit), `formErrorHandler()` stores the errors and the submitted values in the session and redirects (303) to the page the form was on: the last full page a GET rendered in this session, else the `Referer` when it's this site, else `formErrorHandler(fallback, { fallbackUrl })` (default `/`). `fetch()` posting `FormData`, API calls and everything else go to the usual error handler. It needs `session()`; without it a failed form post gets the usual 422. With Inertia, put Inertia's handler inside: `formErrorHandler(inertiaErrorHandler())`.
- **In templates.** Every template, components included, has `$errors` (field → first message, `form` for the body as a whole), `$old` (what was submitted) and `$flash` (what `flash()` set). Each shows on the next page only. `@error('field') { … }` renders when that field has an error, with the message as `$message`.
- **Refilling.** A named `<input>`, `<textarea>`, `<select>` (its `<option>`s), checkbox or radio takes its value back from `$old` by itself. It's left alone when the template sets `value`, `checked` or `selected`, and never refilled for passwords, files, hidden fields, a bound `[type]`, or names that look like secrets (`password`, `pwd`, `pin`, `otp`, `token`, `secret`, `card`, `cvv`, `csrf`). Options and checkboxes compare with their `value`, written or interpolated (`value="{{ c.id }}"`). The values ride in the session, so they're capped: a field over 1,000 bytes isn't kept, and over 1,500 bytes in all nothing is (the errors still are), so a cookie session can't overflow.
- **Re-rendering instead.** A controller can answer with the form itself; its own `$errors` and `$old` win over the session's:

  ```ts
  import { fieldErrors } from '@forinda/kickjs'

  // issues: [{ field: 'title', message: 'Too short' }], the shape route validation uses
  const issues = await this.products.check(ctx.body)
  if (issues.length)
    return ctx.render('products/new', { $errors: fieldErrors(issues), $old: ctx.body })
  ```

- **Field names are flat** (`title`, `email`) for now. Nested names (`items[0][name]`) and lists of values (a group of checkboxes with one name) aren't refilled yet.

## Checking in the browser

Add `validate` to a field for instant feedback, before the form is sent. It writes into the same `@error` spot the server's message uses:

```kick
<input name="email" validate="required | email">
@error('email') {
  <b>{{ $message }}</b>
}
<input name="title" validate="required | minLength:3 | maxLength:120">
@error('title') {
  <b>{{ $message }}</b>
}
```

- **Validators:** `required`, `email`, `url` (http or https), `minLength:n` and `maxLength:n` (characters), `min:n` and `max:n` (numbers), `pattern:'regex'` (the whole value), `in:'a, b, c'`. An empty field passes everything except `required`. An unknown validator or a wrong argument fails the check.
- **When it runs:** when the field loses focus, then as it changes once it has been checked, and on submit. A submit with an invalid field is stopped and the first one gets focus. `required` on a radio or checkbox passes when any one in the group with that name is checked. The browser's own checks on the same form (a plain `required`, `type="email"`) still run after these pass; forms without a `validate` field are left entirely to the browser.
- **Where messages go:** `@error('field')` always renders a `<span data-kick-error="field" aria-live="polite">` spot, hidden while there's no error: the server's message in it after a failed submit, the browser's while typing. Because it's a `<span>`, keep the body inline (text, `<b>`, `<small>`); a `<p>`, `<li>` or `<tr>` inside it is invalid HTML, and in a table the browser moves it out. Style it with `[data-kick-error]:not([hidden])`, so empty spots stay hidden. The field gets `aria-invalid` and `aria-describedby` pointing at its message, and `setCustomValidity`, so `:user-invalid` works in CSS.
- **What ships:** a page with a `validate` field gets one small validator script (`/_kick/c/kick-validate.<hash>.js`); pages without one get none.
- **The server still decides.** These checks are for quick feedback; route validation in the controller is what counts, and its messages can differ.

## Your own validators

Rules of your own go in `src/views/validators.ts`, next to `pipes.ts`. Each export is a validator, used by its name like the built-ins:

```ts
// src/views/validators.ts
export const phone = (value: string) =>
  /^\+?\d{9,15}$/.test(value) ? undefined : 'Enter a phone number'

export const sameAs = (value: string, other: string, form: HTMLFormElement) =>
  value === (form.elements.namedItem(other) as HTMLInputElement | null)?.value
    ? undefined
    : 'Must match'
```

```kick
<input name="phone" validate="required | phone">
@error('phone') {
  {{ $message }}
}
<input name="password" type="password" validate="required | minLength:8">
<input name="confirm" type="password" validate="sameAs:'password'">
@error('confirm') {
  {{ $message }}
}
```

- **The contract:** a validator gets the field's value, then the arguments written in the template (numbers or quoted strings), then the form. It returns the message when the value fails. Anything else passes: `undefined`, `null`, `false`, an empty string, `true`.
- **Same rules as the built-ins:** an empty field skips them (only `required` checks for one), they run in the order written, and the first message wins. A validator that throws counts as a pass and is logged with `console.error`, so a bug can't block the form.
- **Checked like pipes:** an unknown name fails `kick build`, `kick check:views` and the page in `kick dev`, and the editor marks it. An export named like a built-in fails `kick build` and `kick check:views`; `kick dev` logs a warning and the built-in keeps its meaning. The editor also completes validator names inside `validate="…"`.
- **What ships:** the file can import npm packages and your own files, like a component script. `kick build` bundles it as `kick-validators.<hash>.js`, loaded after the built-in validator script on pages with a `validate` field; `kick dev` serves it through Vite. Running from source without either, it's served as is with its types stripped, and an import fails the page, as it does for component scripts.
- **Browser only.** The route's schema still decides on the server; a rule that needs your data is a [server check](#your-own-checks).

## Your own checks

`validate` covers the common rules. For anything else, a [component with a script](./client-scripts.md) can run your own code against the same `@error` spots. Two recipes cover most needs.

**The route's schema, in the browser.** A component script can import your files and npm packages, so it can import the schema the route validates with. The rules then live in one file and the messages match the server's:

```ts
// src/client/check-form.ts — shared by every form that checks itself
/// <reference lib="dom" />
import type { z } from 'zod'

/** Each field's first message, as route validation reports them. */
function messages(form: HTMLFormElement, schema: z.ZodType): Record<string, string> {
  const result = schema.safeParse(Object.fromEntries(new FormData(form)))
  const out: Record<string, string> = {}
  if (!result.success)
    for (const issue of result.error.issues) out[String(issue.path[0] ?? 'form')] ??= issue.message
  return out
}

/** Fills the form's `@error` spots, for one field or all of them. */
function show(form: HTMLFormElement, errors: Record<string, string>, only?: string): void {
  for (const spot of form.querySelectorAll<HTMLElement>('[data-kick-error]')) {
    const field = spot.dataset.kickError!
    if (only && field !== only) continue
    const message = errors[field] ?? ''
    spot.textContent = message
    spot.hidden = !message
    const input = form.elements.namedItem(field)
    if (input instanceof HTMLElement && 'setCustomValidity' in input) {
      ;(input as HTMLInputElement).setCustomValidity(message)
      input.setAttribute('aria-invalid', String(!!message))
    }
  }
}

/** Checks a field when it loses focus, and every field on submit. */
export function checkWith(form: HTMLFormElement, schema: z.ZodType): void {
  form.noValidate = true
  form.addEventListener('focusout', (e) => {
    const name = (e.target as HTMLInputElement).name
    if (name) show(form, messages(form, schema), name)
  })
  form.addEventListener('submit', (e) => {
    const errors = messages(form, schema)
    show(form, errors)
    const first = Object.keys(errors)[0]
    if (!first) return
    e.preventDefault()
    ;(form.elements.namedItem(first) as HTMLElement | null)?.focus()
  })
}
```

```kick
{{-- src/views/components/task-form.kick --}}
@input categories
<task-form-check>
  <form method="post" action="/tasks">
    <input name="title" placeholder="What needs doing?">
    @error('title') {
      {{ $message }}
    }
    <select name="categoryId">
      <option value="">None</option>
      @for (c of categories; track c.id) {
        <option value="{{ c.id }}">{{ c.name }}</option>
      }
    </select>
    <button>Add</button>
  </form>
</task-form-check>

<script client>
  import { checkWith } from '@/client/check-form'
  import { taskSchema } from '@/modules/tasks/tasks.schemas'

  class TaskFormCheck extends HTMLElement {
    connectedCallback(): void {
      checkWith(this.querySelector('form')!, taskSchema)
    }
  }
  customElements.get('task-form-check') || customElements.define('task-form-check', TaskFormCheck)
</script>
```

- **Browser types.** The server's `tsconfig` has no DOM types, so a browser file under `src/` names them with `/// <reference lib="dom" />`. Component scripts don't need it.
- **Keep schemas in their own files.** Whatever the schema file imports goes to the browser with it. A schema next to a database client, or anything from `node:`, pulls that into the client build or breaks it. A `*.schemas.ts` that imports only `zod` is safe to share.
- **Size.** Zod adds about 23 KB gzipped to the component's script, and only pages that render the component load it. For a form that needs only `required` or `minLength`, `validate` is a fraction of that.
- **Content Security Policy.** Zod 4 tries `new Function` once for a faster path. Under a CSP without `'unsafe-eval'` the browser reports it as blocked, and Zod carries on without it.
- **Without JavaScript** the form posts as usual, and route validation answers with the same messages.

**Checks that need the server.** Whether an email is already registered, or a name is taken, only the server knows. Give the component a small endpoint to ask, and show the answer in the field's spot:

```ts
@Get('/register/email-taken')
async emailTaken(ctx: RequestContext) {
  const email = String(ctx.query.email ?? '').trim().toLowerCase()
  ctx.json({ taken: email !== '' && (await this.users.exists(email)) })
}
```

```kick
<email-check>
  <input name="email" type="email">
  @error('email') {
    {{ $message }}
  }
</email-check>

<script client>
  class EmailCheck extends HTMLElement {
    connectedCallback(): void {
      const input = this.querySelector('input')!
      const spot = this.querySelector<HTMLElement>('[data-kick-error="email"]')!
      input.addEventListener('change', async () => {
        const email = input.value
        const res = await fetch(`/register/email-taken?email=${encodeURIComponent(email)}`)
        const { taken } = (await res.json()) as { taken: boolean }
        // A slower answer for an earlier value mustn't overwrite the current one.
        if (input.value !== email) return
        spot.textContent = taken ? 'That email is already registered' : ''
        spot.hidden = !taken
      })
    }
  }
  customElements.get('email-check') || customElements.define('email-check', EmailCheck)
</script>
```

The route that saves the form still checks again, since two people can claim the same email between the check and the submit. Rate-limit an endpoint like this one so it can't be used to list your users.

::::

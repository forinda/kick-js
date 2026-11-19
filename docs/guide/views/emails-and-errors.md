# Emails, PDFs, Tests and Error Pages

## Emails, PDFs and tests

`views.render()` works outside a request:

```ts
const html = await views.render('emails/welcome', { name: user.name }, { layout: 'layouts/email' })
await mailer.send({ to: user.email, subject: 'Welcome', html })
```

## Error pages

```ts
bootstrap({
  modules,
  adapters: [KickView({ views })],
  onNotFound: async (req, res) => {
    res
      .status(404)
      .type('text/html; charset=utf-8')
      .send(await views.render('errors/404'))
  },
})
```

In dev a template error shows its file, line and column. In production the response is a plain 500, and the details go to the log.

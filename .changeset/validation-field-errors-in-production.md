---
'@forinda/kickjs': patch
---

A 422 keeps its per-field `errors` in production, so a form can say which field is wrong. Only each entry's `field` and `message` are sent — for route validation, `HttpException.unprocessable()` / `fromZodError()`, and a thrown `ZodError` alike; other members (`code`, raw issues) and every other error's `details` stay out of production responses.

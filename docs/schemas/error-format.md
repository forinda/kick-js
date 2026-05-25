# Error Format Standardization

Every schema library has its own error structure. KickJS normalizes all validation errors into a single format regardless of which library produced them.

## Unified SchemaIssue

```ts
interface SchemaIssue {
  path: string[] // ["address", "zip"] — dotted path segments
  message: string // "Must be at least 5 characters"
  code: string // "min_length", "required", "invalid_type"
  expected?: string // "string", ">=18"
  received?: string // "undefined", "12"
}
```

## HTTP Error Response (422)

```json
{
  "status": 422,
  "message": "Validation failed",
  "errors": [
    {
      "field": "email",
      "message": "Invalid email address",
      "code": "email"
    },
    {
      "field": "age",
      "message": "Must be at least 18",
      "code": "min",
      "expected": ">=18",
      "received": "12"
    },
    {
      "field": "address.zip",
      "message": "Required",
      "code": "required"
    }
  ]
}
```

The `field` value is `path.join('.')` — a dotted string for nested fields.

## Library Error Comparison

### Zod

```ts
// ZodError.issues[]
{
  code: "too_small",
  minimum: 18,
  type: "number",
  inclusive: true,
  exact: false,
  message: "Number must be greater than or equal to 18",
  path: ["age"]
}
// → SchemaIssue
{
  path: ["age"],
  message: "Number must be greater than or equal to 18",
  code: "too_small",
  expected: ">=18",
  received: undefined
}
```

### Valibot

```ts
// Valibot issue
{
  kind: "validation",
  type: "min_value",
  input: 12,
  expected: ">=18",
  received: "12",
  message: "Must be at least 18",
  path: [{ type: "object", origin: "value", input: {...}, key: "age", value: 12 }]
}
// → SchemaIssue
{
  path: ["age"],
  message: "Must be at least 18",
  code: "min_value",
  expected: ">=18",
  received: "12"
}
```

### Yup

```ts
// Yup ValidationError.inner[]
{
  path: "age",
  message: "age must be greater than or equal to 18",
  type: "min",
  params: { min: 18 }
}
// → SchemaIssue
{
  path: ["age"],
  message: "age must be greater than or equal to 18",
  code: "min",
  expected: ">=18"
}
```

### Joi

```ts
// Joi error.details[]
{
  message: "\"age\" must be greater than or equal to 18",
  path: ["age"],
  type: "number.min",
  context: { limit: 18, value: 12, label: "age", key: "age" }
}
// → SchemaIssue
{
  path: ["age"],
  message: "\"age\" must be greater than or equal to 18",
  code: "number.min",
  expected: ">=18",
  received: "12"
}
```

### Standard Schema

```ts
// Standard Schema FailureResult.issues[]
{
  message: "Must be at least 18",
  path: ["age"]
}
// → SchemaIssue
{
  path: ["age"],
  message: "Must be at least 18",
  code: "validation"   // Standard Schema has no code field
}
```

## Custom Error Formatter

Override the default 422 format globally:

```ts
import { bootstrap } from '@forinda/kickjs'

bootstrap({
  validation: {
    formatError(issues: SchemaIssue[], ctx: RequestContext) {
      // RFC 9457 Problem Details
      return {
        type: 'https://api.example.com/errors/validation',
        title: 'Validation Error',
        status: 422,
        detail: `${issues.length} field(s) failed validation`,
        violations: issues.map((i) => ({
          property: i.path.join('.'),
          constraint: i.code,
          message: i.message,
        })),
      }
    },
  },
})
```

## Per-Route Error Handling

```ts
@Post('/', {
  body: createUserSchema,
  onValidationError(issues, ctx) {
    ctx.status(400).json({
      ok: false,
      fields: Object.fromEntries(issues.map((i) => [i.path.join('.'), i.message])),
    })
  },
})
async create(ctx: RequestContext) { /* ... */ }
```

## Error Codes Reference

Common normalized codes across libraries:

| Code           | Meaning                | Zod                  | Valibot                  | Yup         | Joi                   |
| -------------- | ---------------------- | -------------------- | ------------------------ | ----------- | --------------------- |
| `required`     | Missing required field | `invalid_type`       | `non_optional`           | `required`  | `any.required`        |
| `invalid_type` | Wrong type             | `invalid_type`       | `*` (type name)          | `typeError` | `*.base`              |
| `min`          | Below minimum          | `too_small`          | `min_value`/`min_length` | `min`       | `*.min`               |
| `max`          | Above maximum          | `too_big`            | `max_value`/`max_length` | `max`       | `*.max`               |
| `pattern`      | Regex mismatch         | `invalid_string`     | `regex`                  | `matches`   | `string.pattern.base` |
| `email`        | Invalid email          | `invalid_string`     | `email`                  | `email`     | `string.email`        |
| `enum`         | Not in allowed values  | `invalid_enum_value` | `enum_`                  | `oneOf`     | `any.only`            |
| `custom`       | Custom validation      | `custom`             | `custom`                 | `test`      | `any.custom`          |

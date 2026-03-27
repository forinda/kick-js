/**
 * Express middleware that validates request body/query/params against schemas.
 * Works with any validation library that exposes `.safeParse(data)` returning
 * `{ success: true, data }` or `{ success: false, error: { issues } }`.
 */
export function validate(schema) {
    return (req, res, next) => {
        try {
            if (schema.body) {
                const result = schema.body.safeParse(req.body);
                if (!result.success) {
                    return res.status(422).json({
                        message: result.error.issues[0]?.message || 'Validation failed',
                        errors: result.error.issues.map((i) => ({
                            field: i.path.join('.'),
                            message: i.message,
                        })),
                    });
                }
                req.body = result.data;
            }
            if (schema.query) {
                const result = schema.query.safeParse(req.query);
                if (!result.success) {
                    return res.status(422).json({
                        message: 'Invalid query parameters',
                        errors: result.error.issues.map((i) => ({
                            field: i.path.join('.'),
                            message: i.message,
                        })),
                    });
                }
                ;
                req.query = result.data;
            }
            if (schema.params) {
                const result = schema.params.safeParse(req.params);
                if (!result.success) {
                    return res.status(422).json({
                        message: 'Invalid path parameters',
                        errors: result.error.issues.map((i) => ({
                            field: i.path.join('.'),
                            message: i.message,
                        })),
                    });
                }
                ;
                req.params = result.data;
            }
            next();
        }
        catch (err) {
            next(err);
        }
    };
}
//# sourceMappingURL=validate.js.map
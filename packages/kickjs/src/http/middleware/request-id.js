import { randomUUID } from 'node:crypto';
export const REQUEST_ID_HEADER = 'x-request-id';
/** Middleware that generates or propagates a unique request ID */
export function requestId() {
    return (req, res, next) => {
        const id = req.headers[REQUEST_ID_HEADER] || randomUUID();
        req.requestId = id;
        res.setHeader(REQUEST_ID_HEADER, id);
        next();
    };
}
//# sourceMappingURL=request-id.js.map
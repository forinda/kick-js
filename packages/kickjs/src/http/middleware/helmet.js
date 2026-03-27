/**
 * Security headers middleware. Lightweight alternative to the `helmet` npm package
 * with sensible defaults for API servers.
 *
 * @example
 * ```ts
 * bootstrap({
 *   middleware: [helmet(), requestId(), express.json()],
 * })
 * ```
 */
export function helmet(options = {}) {
    const { noSniff = true, frameguard = 'DENY', hsts = { maxAge: 31536000, includeSubDomains: true }, dnsPrefetch = false, hidePoweredBy = true, referrerPolicy = 'no-referrer', xssFilter = true, contentSecurityPolicy = false, } = options;
    return (req, res, next) => {
        if (hidePoweredBy)
            res.removeHeader('X-Powered-By');
        if (noSniff)
            res.setHeader('X-Content-Type-Options', 'nosniff');
        if (frameguard)
            res.setHeader('X-Frame-Options', frameguard);
        if (xssFilter)
            res.setHeader('X-XSS-Protection', '0');
        if (referrerPolicy)
            res.setHeader('Referrer-Policy', referrerPolicy);
        if (!dnsPrefetch)
            res.setHeader('X-DNS-Prefetch-Control', 'off');
        if (hsts) {
            const maxAge = hsts.maxAge ?? 31536000;
            let value = `max-age=${maxAge}`;
            if (hsts.includeSubDomains)
                value += '; includeSubDomains';
            if (hsts.preload)
                value += '; preload';
            res.setHeader('Strict-Transport-Security', value);
        }
        if (contentSecurityPolicy) {
            const policy = typeof contentSecurityPolicy === 'object'
                ? Object.entries(contentSecurityPolicy)
                    .map(([key, values]) => `${key} ${values.join(' ')}`)
                    .join('; ')
                : "default-src 'self'";
            res.setHeader('Content-Security-Policy', policy);
        }
        next();
    };
}
//# sourceMappingURL=helmet.js.map
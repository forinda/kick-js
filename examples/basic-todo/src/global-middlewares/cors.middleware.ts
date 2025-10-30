import { KickAppMiddleware, KickRequest, KickResponse, KickNextFn } from "@forinda/kickjs";

/**
 * Global CORS middleware - not managed by DI container
 * This is a simple global middleware for cross-origin requests
 */
export class CorsMiddleware implements KickAppMiddleware {
    use(req: KickRequest, res: KickResponse, next: KickNextFn): void {
        console.log(`[CorsMiddleware]: Processing ${req.method} ${req.url}`);
        
        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        
        // Handle preflight requests
        if (req.method === 'OPTIONS') {
            res.status(200).end();
            return;
        }
        
        next();
    }
}
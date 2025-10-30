import { BaseKickMiddleware, KickMiddleware, KickRequest, KickResponse, KickNextFn } from "@forinda/kickjs";

@KickMiddleware({ 
    name: 'SimpleAuth', 
    priority: 2, 
    global: false,
    tags: ['auth', 'security']
})
export class AuthMiddleware extends BaseKickMiddleware {
    private apiKey = 'demo-api-key';

    use = (req: KickRequest, res: KickResponse, next: KickNextFn) => {
        const authHeader = req.headers.authorization;
        
        // Skip auth for GET requests (allow reading todos)
        if (req.method === 'GET') {
            console.log('[AuthMiddleware] Allowing GET request without auth');
            return next();
        }

        if (!authHeader || authHeader !== `Bearer ${this.apiKey}`) {
            console.log('[AuthMiddleware] Authentication failed');
            res.status(401).json({ 
                error: 'Unauthorized', 
                message: 'Please provide a valid API key in Authorization header',
                hint: `Use: Authorization: Bearer ${this.apiKey}`
            });
            return;
        }

        console.log('[AuthMiddleware] Authentication successful');
        next();
    }

    // Example of additional bound method that can be used elsewhere
    validateApiKey = (key: string): boolean => {
        return key === this.apiKey;
    }

    // Example of getting current API key (demonstrates autobind working)
    getCurrentApiKey = (): string => {
        return this.apiKey;
    }
}
import { BaseKickMiddleware, KickMiddleware, KickRequest, KickResponse, KickNextFn } from "../../../../src";

@KickMiddleware({ 
    name: 'RequestLogger', 
    priority: 1, 
    global: true,
    tags: ['logging', 'development']
})
export class TestMiddleware extends BaseKickMiddleware {
    use = (req: KickRequest, _res: KickResponse, next: KickNextFn) => {
        console.log(`[TestMiddleware] ${req.method} ${req.url} - ${new Date().toISOString()}`);
        next();
    }
}
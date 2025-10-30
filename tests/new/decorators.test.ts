import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { 
  KickController, 
  KickMiddleware, 
  isKickMiddleware, 
  getMiddlewareMetadata 
} from '../../src';

describe('KickJS Decorators Tests', () => {
  it('should apply KickController decorator correctly', () => {
    @KickController('/users')
    class UserController {
      getUsers() {
        return { users: [] };
      }
    }

    expect(UserController).toBeDefined();
    expect(UserController.name).toBe('UserController');
  });

  it('should apply KickMiddleware decorator correctly', () => {
    @KickMiddleware({ priority: 5 })
    class AuthMiddleware {
      use(req: any, res: any, next: any) {
        next();
      }
    }

    expect(AuthMiddleware).toBeDefined();
    expect(isKickMiddleware(AuthMiddleware)).toBe(true);
    
    const metadata = getMiddlewareMetadata(AuthMiddleware);
    expect(metadata).toBeDefined();
    expect(metadata?.priority).toBe(5);
    expect(metadata?.className).toBe('AuthMiddleware');
  });

  it('should handle middleware without priority', () => {
    @KickMiddleware({})
    class SimpleMiddleware {
      use(req: any, res: any, next: any) {
        next();
      }
    }

    const metadata = getMiddlewareMetadata(SimpleMiddleware);
    expect(metadata?.priority).toBe(0); // Default priority
  });

  it('should validate middleware metadata helpers', () => {
    class RegularClass {
      someMethod() {
        return 'not middleware';
      }
    }

    expect(isKickMiddleware(RegularClass)).toBe(false);
    expect(getMiddlewareMetadata(RegularClass)).toBeUndefined();
  });

  it('should handle multiple middleware decorations', () => {
    @KickMiddleware({ priority: 1 })
    class FirstMiddleware {
      use(req: any, res: any, next: any) {
        next();
      }
    }

    @KickMiddleware({ priority: 10 })
    class SecondMiddleware {
      use(req: any, res: any, next: any) {
        next();
      }
    }

    const firstMeta = getMiddlewareMetadata(FirstMiddleware);
    const secondMeta = getMiddlewareMetadata(SecondMiddleware);

    expect(firstMeta?.priority).toBe(1);
    expect(secondMeta?.priority).toBe(10);
    expect(firstMeta?.className).toBe('FirstMiddleware');
    expect(secondMeta?.className).toBe('SecondMiddleware');
  });
});
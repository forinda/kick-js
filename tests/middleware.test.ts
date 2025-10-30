import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { 
  KickMiddleware, 
  isKickMiddleware, 
  getMiddlewareMetadata,
  createModule,
  KickApp
} from '../src';

// Test Middlewares with different priorities
@KickMiddleware({ priority: 1 })
class HighPriorityMiddleware {
  use(req: any, res: any, next: any) {
    req.executionOrder = req.executionOrder || [];
    req.executionOrder.push('high-priority');
    next();
  }
}

@KickMiddleware({ priority: 5 })
class MediumPriorityMiddleware {
  use(req: any, res: any, next: any) {
    req.executionOrder = req.executionOrder || [];
    req.executionOrder.push('medium-priority');
    next();
  }
}

@KickMiddleware({ priority: 10 })
class LowPriorityMiddleware {
  use(req: any, res: any, next: any) {
    req.executionOrder = req.executionOrder || [];
    req.executionOrder.push('low-priority');
    next();
  }
}

@KickMiddleware({}) // No priority - should default to 0
class DefaultPriorityMiddleware {
  use(req: any, res: any, next: any) {
    req.executionOrder = req.executionOrder || [];
    req.executionOrder.push('default-priority');
    next();
  }
}

// Error handling middleware
@KickMiddleware({ priority: 1 })
class ErrorHandlingMiddleware {
  use(req: any, res: any, next: any) {
    try {
      req.errorHandled = true;
      next();
    } catch (error) {
      console.error('Middleware error:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
}

// Authentication middleware
@KickMiddleware({ priority: 2 })
class AuthenticationMiddleware {
  use(req: any, res: any, next: any) {
    // Mock authentication
    const authHeader = req.headers?.authorization;
    if (authHeader === 'Bearer valid-token') {
      req.user = { id: 'user-123', role: 'admin' };
      req.authenticated = true;
    } else {
      req.authenticated = false;
    }
    next();
  }
}

describe('Middleware System Tests', () => {
  it('should correctly identify middleware classes', () => {
    expect(isKickMiddleware(HighPriorityMiddleware)).toBe(true);
    expect(isKickMiddleware(MediumPriorityMiddleware)).toBe(true);
    expect(isKickMiddleware(LowPriorityMiddleware)).toBe(true);
    expect(isKickMiddleware(DefaultPriorityMiddleware)).toBe(true);
    
    // Regular class should not be identified as middleware
    class RegularClass {}
    expect(isKickMiddleware(RegularClass)).toBe(false);
  });

  it('should extract correct metadata from middleware classes', () => {
    const highMeta = getMiddlewareMetadata(HighPriorityMiddleware);
    expect(highMeta).toBeDefined();
    expect(highMeta?.priority).toBe(1);
    expect(highMeta?.className).toBe('HighPriorityMiddleware');

    const mediumMeta = getMiddlewareMetadata(MediumPriorityMiddleware);
    expect(mediumMeta?.priority).toBe(5);
    expect(mediumMeta?.className).toBe('MediumPriorityMiddleware');

    const defaultMeta = getMiddlewareMetadata(DefaultPriorityMiddleware);
    expect(defaultMeta?.priority).toBe(0); // Default priority
    expect(defaultMeta?.className).toBe('DefaultPriorityMiddleware');
  });

  it('should handle middleware registration in modules', () => {
    expect(() => {
      const middlewareModule = createModule('MiddlewareModule', {
        controllers: [],
        middlewares: [
          HighPriorityMiddleware,
          MediumPriorityMiddleware,
          LowPriorityMiddleware,
          DefaultPriorityMiddleware
        ]
      });
      
      expect(middlewareModule).toBeDefined();
      expect(middlewareModule.name).toBe('MiddlewareModule');
    }).not.toThrow();
  });

  it('should register middlewares in app correctly', () => {
    const mockContext = {
      requestHandlers: {},
      middlewares: [],
      app: {} as any // Mock express app
    };
    
    const app = new KickApp(mockContext, 'MiddlewareTestApp');
    
    const middlewareModule = createModule('MiddlewareModule', {
      controllers: [],
      middlewares: [
        HighPriorityMiddleware,
        MediumPriorityMiddleware,
        LowPriorityMiddleware
      ]
    });

    expect(() => {
      app.loadModules([middlewareModule]);
    }).not.toThrow();
  });

  it('should handle authentication middleware correctly', () => {
    const authMeta = getMiddlewareMetadata(AuthenticationMiddleware);
    expect(authMeta?.priority).toBe(2);
    expect(authMeta?.className).toBe('AuthenticationMiddleware');

    // Test middleware function
    const authMiddleware = new AuthenticationMiddleware();
    const mockReq = { 
      headers: { authorization: 'Bearer valid-token' },
      user: null,
      authenticated: false 
    };
    const mockRes = {};
    let nextCalled = false;
    const mockNext = () => { nextCalled = true; };

    authMiddleware.use(mockReq, mockRes, mockNext);

    expect(nextCalled).toBe(true);
    expect(mockReq.authenticated).toBe(true);
    expect(mockReq.user).toEqual({ id: 'user-123', role: 'admin' });
  });

  it('should handle error middleware correctly', () => {
    const errorMiddleware = new ErrorHandlingMiddleware();
    const mockReq = { errorHandled: false };
    const mockRes = {};
    let nextCalled = false;
    const mockNext = () => { nextCalled = true; };

    errorMiddleware.use(mockReq, mockRes, mockNext);

    expect(nextCalled).toBe(true);
    expect(mockReq.errorHandled).toBe(true);
  });

  it('should handle middleware without priority gracefully', () => {
    @KickMiddleware({})
    class NoPriorityMiddleware {
      use(req: any, res: any, next: any) {
        next();
      }
    }

    const metadata = getMiddlewareMetadata(NoPriorityMiddleware);
    expect(metadata?.priority).toBe(0);
    expect(isKickMiddleware(NoPriorityMiddleware)).toBe(true);
  });

  it('should validate middleware execution order based on priority', () => {
    // This test validates that middleware metadata is set correctly for priority ordering
    const middlewares = [
      { class: LowPriorityMiddleware, expectedPriority: 10 },
      { class: MediumPriorityMiddleware, expectedPriority: 5 },
      { class: HighPriorityMiddleware, expectedPriority: 1 },
      { class: DefaultPriorityMiddleware, expectedPriority: 0 }
    ];

    middlewares.forEach(({ class: middlewareClass, expectedPriority }) => {
      const metadata = getMiddlewareMetadata(middlewareClass);
      expect(metadata?.priority).toBe(expectedPriority);
    });
  });
});
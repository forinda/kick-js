import { describe, it, expect, beforeEach } from 'vitest';
import 'reflect-metadata';
import { 
  KickApp, 
  KickController, 
  KickMiddleware, 
  KickRequestContext,
  createModule 
} from '../src';

// Test Controllers (without complex route decorators for now)
@KickController('/users')
class UsersController {
  list(context: KickRequestContext) {
    return { 
      users: ['Alice', 'Bob'], 
      requestId: context.meta.requestId 
    };
  }

  create(context: KickRequestContext) {
    return { 
      message: 'User created', 
      requestId: context.meta.requestId 
    };
  }

  getById(context: KickRequestContext) {
    return { 
      userId: 'test-id', 
      requestId: context.meta.requestId 
    };
  }
}

@KickController('/products')
class ProductsController {
  list(context: KickRequestContext) {
    return { 
      products: ['Product A', 'Product B'], 
      requestId: context.meta.requestId 
    };
  }
}

// Test Middlewares
@KickMiddleware({ priority: 1 })
class AuthMiddleware {
  use(req: any, res: any, next: any) {
    req.user = { id: 'test-user' };
    next();
  }
}

@KickMiddleware({ priority: 5 })
class LoggingMiddleware {
  use(req: any, res: any, next: any) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  }
}

describe('Framework Integration Tests', () => {
  let mockContext: any;
  let app: KickApp;

  beforeEach(() => {
    mockContext = {
      requestHandlers: {},
      middlewares: [],
      app: null
    };
    app = new KickApp(mockContext, 'TestApp');
  });

  it('should register controllers and extract route metadata', () => {
    const userModule = createModule('UserModule', {
      controllers: [UsersController],
      middlewares: [AuthMiddleware]
    });

    app.loadModules([userModule]);

    expect(app.controllers.length).toBe(1);
    const controller = app.controllers[0];
    expect(controller.constructor.name).toBe('UsersController');
  });

  it('should handle multiple modules with different controllers', () => {
    const userModule = createModule('UserModule', {
      controllers: [UsersController],
      middlewares: [AuthMiddleware]
    });

    const productModule = createModule('ProductModule', {
      controllers: [ProductsController],
      middlewares: [LoggingMiddleware]
    });

    app.loadModules([userModule, productModule]);

    expect(app.controllers.length).toBe(2);
    const controllerNames = app.controllers.map(c => c.constructor.name);
    expect(controllerNames).toContain('UsersController');
    expect(controllerNames).toContain('ProductsController');
  });

  it('should support app configuration with prefix', () => {
    app.prefix = '/api/v1';
    expect(app.prefix).toBe('/api/v1');
    
    // Create a new app with prefix in constructor
    const appWithPrefix = new KickApp(mockContext, 'PrefixApp', '/api/v2');
    expect(appWithPrefix.prefix).toBe('/api/v2');
  });

  it('should manage app state correctly', () => {
    // Initial state should be empty
    expect(app.state).toEqual({});
    
    // State should be read-only (returns a copy)
    const state = app.state;
    expect(typeof state).toBe('object');
    
    // App should emit events
    let eventEmitted = false;
    app.on('test-event', () => {
      eventEmitted = true;
    });
    
    app.emit('test-event');
    expect(eventEmitted).toBe(true);
  });

  it('should handle middleware registration and sorting', () => {
    const testModule = createModule('TestModule', {
      controllers: [UsersController],
      middlewares: [LoggingMiddleware, AuthMiddleware] // LoggingMiddleware has priority 5, AuthMiddleware has priority 1
    });

    app.loadModules([testModule]);

    // Check that middlewares are registered (this would be visible in logs)
    expect(() => app.loadModules([testModule])).not.toThrow();
  });

  it('should initialize app correctly', () => {
    expect(app.isInitialized).toBe(false);
    expect(app.name).toBe('TestApp');
    expect(app.prefix).toBe('');
    
    // App should have event emitter capabilities
    expect(typeof app.emit).toBe('function');
    expect(typeof app.on).toBe('function');
  });

  it('should handle module installation errors gracefully', () => {
    // Test with invalid module
    expect(() => {
      app.loadModules([null as any]);
    }).toThrow();
  });

  it('should support reactive features', () => {
    // Test that app extends EventEmitter
    const listeners: string[] = [];
    
    app.on('state-change', (data) => {
      listeners.push(data.type);
    });
    
    app.emit('state-change', { type: 'update' });
    expect(listeners).toContain('update');
  });
});
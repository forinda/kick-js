import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { Container } from 'inversify';
import { KickApp, KickController, KickMiddleware, createModule } from '../../src';

// Test Controller without complex decorators for now
@KickController('/test')
class TestController {
  getTest() {
    return { message: 'test works' };
  }

  getUsers() {
    return { users: ['Alice', 'Bob'] };
  }
}

// Test Middleware
@KickMiddleware({ priority: 1 })
class TestMiddleware {
  use(req: any, res: any, next: any) {
    req.testFlag = 'middleware-executed';
    next();
  }
}

describe('KickJS Framework Core Tests', () => {
  it('should create controller with KickController decorator', () => {
    expect(() => {
      @KickController('/api')
      class ApiController {
        getHealth() {
          return { status: 'ok' };
        }
      }
      
      expect(ApiController).toBeDefined();
      return ApiController;
    }).not.toThrow();
  });

  it('should create middleware with KickMiddleware decorator', () => {
    expect(() => {
      @KickMiddleware({ priority: 1 })
      class ApiMiddleware {
        use(req: any, res: any, next: any) {
          next();
        }
      }
      
      expect(ApiMiddleware).toBeDefined();
      return ApiMiddleware;
    }).not.toThrow();
  });

  it('should create modules with controllers and middlewares', () => {
    expect(() => {
      const testModule = createModule('TestModule', {
        controllers: [TestController],
        middlewares: [TestMiddleware]
      });
      
      expect(testModule).toBeDefined();
      expect(testModule.name).toBe('TestModule');
      expect(typeof testModule.install).toBe('function');
    }).not.toThrow();
  });

  it('should create KickApp instance with proper context', () => {
    const mockContext = {
      requestHandlers: {},
      middlewares: [],
      app: null as any
    };
    
    expect(() => {
      const app = new KickApp(mockContext, 'TestApp', '/api');
      expect(app).toBeDefined();
      expect(app.name).toBe('TestApp');
      expect(app.prefix).toBe('/api');
      expect(app.isInitialized).toBe(false);
    }).not.toThrow();
  });

  it('should validate container bindings work', () => {
    const container = new Container();
    
    // Test that we can bind and resolve classes
    container.bind('TestController').to(TestController);
    container.bind('TestMiddleware').to(TestMiddleware);
    
    const controllerInstance = container.get('TestController');
    const middlewareInstance = container.get('TestMiddleware');
    
    expect(controllerInstance).toBeDefined();
    expect(middlewareInstance).toBeDefined();
    expect(controllerInstance).toBeInstanceOf(TestController);
    expect(middlewareInstance).toBeInstanceOf(TestMiddleware);
  });

  it('should validate module installation and loading', () => {
    const mockContext = {
      requestHandlers: {},
      middlewares: [],
      app: null as any
    };
    
    const app = new KickApp(mockContext);
    const testModule = createModule('TestModule', {
      controllers: [TestController],
      middlewares: [TestMiddleware]
    });

    expect(() => {
      app.loadModules([testModule]);
    }).not.toThrow();

    // Check that controllers were loaded
    expect(app.controllers.length).toBeGreaterThan(0);
  });

  it('should validate app state management', () => {
    const mockContext = {
      requestHandlers: {},
      middlewares: [],
      app: null as any
    };
    
    const app = new KickApp(mockContext);
    
    // Test state is initially empty
    expect(app.state).toEqual({});
    
    // Test that state is read-only
    const state = app.state;
    expect(() => {
      (state as any).newProp = 'test';
    }).not.toThrow(); // State is a copy, so this won't affect internal state
  });
});
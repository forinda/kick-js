import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { KickApp, createModule, KickController, KickMiddleware } from '../src';

// Test controller for configuration tests
@KickController('/config')
class ConfigController {
  getConfig() {
    return { message: 'Config endpoint' };
  }
}

@KickMiddleware({ priority: 1 })
class ConfigMiddleware {
  use(req: any, res: any, next: any) {
    req.configProcessed = true;
    next();
  }
}

describe('Configuration Tests', () => {
  it('should create app with default configuration', () => {
    const mockContext = {
      requestHandlers: {},
      middlewares: [],
      app: {} as any
    };

    const app = new KickApp(mockContext);
    
    expect(app.name).toBe('KickApp'); // Default name
    expect(app.prefix).toBe(''); // Default prefix
    expect(app.isInitialized).toBe(false);
    expect(app.state).toEqual({});
  });

  it('should create app with custom configuration', () => {
    const mockContext = {
      requestHandlers: {},
      middlewares: [],
      app: {} as any
    };

    const app = new KickApp(mockContext, 'CustomApp', '/api/v1');
    
    expect(app.name).toBe('CustomApp');
    expect(app.prefix).toBe('/api/v1');
    expect(app.isInitialized).toBe(false);
  });

  it('should handle prefix configuration changes', () => {
    const mockContext = {
      requestHandlers: {},
      middlewares: [],
      app: {} as any
    };

    const app = new KickApp(mockContext, 'TestApp');
    
    // Initial prefix should be empty
    expect(app.prefix).toBe('');
    
    // Change prefix
    app.prefix = '/v2';
    expect(app.prefix).toBe('/v2');
    
    // Change prefix again
    app.prefix = '/api/v3';
    expect(app.prefix).toBe('/api/v3');
  });

  it('should maintain app state correctly', () => {
    const mockContext = {
      requestHandlers: {},
      middlewares: [],
      app: {} as any
    };

    const app = new KickApp(mockContext);
    
    // State should be read-only copy
    const state1 = app.state;
    const state2 = app.state;
    
    expect(state1).toEqual(state2);
    expect(state1).not.toBe(state2); // Different objects (copies)
  });

  it('should handle module configuration correctly', () => {
    const mockContext = {
      requestHandlers: {},
      middlewares: [],
      app: {} as any
    };

    const app = new KickApp(mockContext, 'ModuleTestApp');
    
    const configModule = createModule('ConfigModule', {
      controllers: [ConfigController],
      middlewares: [ConfigMiddleware]
    });

    expect(() => {
      app.loadModules([configModule]);
    }).not.toThrow();

    // Check that controllers and middlewares were loaded
    expect(app.controllers.length).toBe(1);
    expect(app.controllers[0].constructor.name).toBe('ConfigController');
  });

  it('should handle empty module configurations', () => {
    const mockContext = {
      requestHandlers: {},
      middlewares: [],
      app: {} as any
    };

    const app = new KickApp(mockContext);
    
    const emptyModule = createModule('EmptyModule', {
      controllers: [],
      middlewares: []
    });

    expect(() => {
      app.loadModules([emptyModule]);
    }).not.toThrow();

    expect(app.controllers.length).toBe(0);
  });

  it('should handle multiple module loading', () => {
    const mockContext = {
      requestHandlers: {},
      middlewares: [],
      app: {} as any
    };

    const app = new KickApp(mockContext);
    
    const module1 = createModule('Module1', {
      controllers: [ConfigController],
      middlewares: []
    });

    const module2 = createModule('Module2', {
      controllers: [],
      middlewares: [ConfigMiddleware]
    });

    expect(() => {
      app.loadModules([module1, module2]);
    }).not.toThrow();

    expect(app.controllers.length).toBe(1);
  });

  it('should validate app properties are accessible', () => {
    const mockContext = {
      requestHandlers: {},
      middlewares: [],
      app: {} as any
    };

    const app = new KickApp(mockContext, 'PropertyTestApp', '/test');
    
    // All properties should be accessible
    expect(typeof app.name).toBe('string');
    expect(typeof app.prefix).toBe('string');
    expect(typeof app.isInitialized).toBe('boolean');
    expect(typeof app.state).toBe('object');
    expect(Array.isArray(app.controllers)).toBe(true);
    
    // Methods should be available
    expect(typeof app.loadModules).toBe('function');
    expect(typeof app.emit).toBe('function');
    expect(typeof app.on).toBe('function');
  });

  it('should handle app context correctly', () => {
    const mockContext = {
      requestHandlers: { '/test': {} as any },
      middlewares: [{ use: () => {}, priority: 1 }] as any[],
      app: { use: () => {}, get: () => {} } as any
    };

    const app = new KickApp(mockContext, 'ContextTestApp');
    
    expect(app.context).toBe(mockContext);
    expect(app.context.requestHandlers).toBe(mockContext.requestHandlers);
    expect(app.context.middlewares).toBe(mockContext.middlewares);
    expect(app.context.app).toBe(mockContext.app);
  });
});
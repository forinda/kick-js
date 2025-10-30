import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { RouteMapper } from '../../src/core/utils/route-mapper';
import type { KickRequestContext } from '../../src';

describe('RouteMapper Tests', () => {
  it('should create RouteMapper instance', () => {
    expect(() => {
      const mapper = new RouteMapper();
      expect(mapper).toBeDefined();
    }).not.toThrow();
  });

  it('should create contextual handler with static method', () => {
    const mockController = {
      constructor: { name: 'TestController' },
      testMethod: (context: KickRequestContext) => {
        return { requestId: context.meta.requestId };
      }
    };

    const mockRoute = {
      path: '/test',
      method: 'GET' as const,
      handlerName: 'testMethod',
      handler: mockController.testMethod,
      middlewares: []
    };

    const contextualHandler = RouteMapper.createContextualHandler(mockController, mockRoute, '/api');
    expect(typeof contextualHandler).toBe('function');
  });

  it('should handle route path building correctly', () => {
    // Test buildRoutePath method with two parameters
    expect(() => {
      const result = RouteMapper.buildRoutePath('/api', '/users');
      expect(result).toBe('/api/users');
    }).not.toThrow();
  });

  it('should normalize route paths correctly', () => {
    // Test that double slashes and trailing slashes are handled
    const testCases = [
      { prefix: '', path: '/users', expected: '/users' },
      { prefix: '/api/', path: '/users/', expected: '/api/users' }, // Note: trailing slash preserved in route path
      { prefix: '/api', path: 'users', expected: '/api/users' },
      { prefix: '', path: '', expected: '/' },
      { prefix: '/api/', path: '/users', expected: '/api/users' },
    ];

    testCases.forEach(({ prefix, path, expected }) => {
      const result = RouteMapper.buildRoutePath(prefix, path);
      expect(result).toBe(expected);
    });
  });

  it('should handle empty prefixes correctly', () => {
    const result = RouteMapper.buildRoutePath('', '/users');
    expect(result).toBe('/users');
  });

  it('should create proper request context in handler', () => {
    const mockController = {
      constructor: { name: 'TestController' },
      testMethod: (context: KickRequestContext) => {
        expect(context.req).toBeDefined();
        expect(context.res).toBeDefined();
        expect(context.next).toBeDefined();
        expect(context.meta).toBeDefined();
        expect(context.meta.requestId).toBeDefined();
        expect(context.meta.startTime).toBeDefined();
        expect(context.meta.routePath).toBe('/api/test');
        expect(context.meta.method).toBe('GET');
        expect(context.meta.controllerName).toBe('TestController');
        expect(context.meta.handlerName).toBe('testMethod');
        return { success: true };
      }
    };

    const mockRoute = {
      path: '/test',
      method: 'GET' as const,
      handlerName: 'testMethod',
      handler: mockController.testMethod,
      middlewares: []
    };

    const mockReq = { method: 'GET', url: '/api/test' };
    const mockRes = { json: () => {}, status: () => ({ json: () => {} }) };
    const mockNext = () => {};

    const contextualHandler = RouteMapper.createContextualHandler(mockController, mockRoute, '/api');

    expect(() => {
      contextualHandler(mockReq as any, mockRes as any, mockNext);
    }).not.toThrow();
  });

  it('should handle controller mapping', () => {
    const mockController = {
      constructor: { name: 'UserController' }
    };

    const mockRoutes = [
      {
        path: '/list',
        method: 'GET' as const,
        handlerName: 'list',
        handler: () => {},
        middlewares: []
      },
      {
        path: '/create',
        method: 'POST' as const,
        handlerName: 'create',
        handler: () => {},
        middlewares: []
      }
    ];

    expect(() => {
      const mappedRoutes = RouteMapper.mapControllerRoutes(mockController, mockRoutes, '/api');
      expect(mappedRoutes).toBeDefined();
      expect(mappedRoutes.length).toBe(2);
      expect(mappedRoutes[0].fullPath).toBe('/api/list');
      expect(mappedRoutes[1].fullPath).toBe('/api/create');
      expect(mappedRoutes[0].controllerName).toBe('UserController');
    }).not.toThrow();
  });
});
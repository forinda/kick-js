import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bindClassMethods } from '../src/core/utils/bind-class-methods';
import { normalizeRoutePath } from '../src/core/utils/normalize-route-path';
import { mapController } from '../src/core/utils/controller-mapper';
import { KickController } from '../src';

// Test controller for utility tests
@KickController('/utils')
class UtilsTestController {
  private message = 'Hello from utils';

  getMethod() {
    return { message: this.message };
  }

  postMethod() {
    return { message: this.message, action: 'created' };
  }

  updateMessage(newMessage: string) {
    this.message = newMessage;
    return { message: this.message };
  }
}

describe('Utility Functions Tests', () => {
  describe('bindClassMethods', () => {
    it('should bind class methods to instance', () => {
      const controller = new UtilsTestController();
      
      // bindClassMethods modifies the instance in place and returns void
      expect(() => {
        bindClassMethods(controller);
      }).not.toThrow();

      // After binding, methods should still work
      expect(typeof controller.getMethod).toBe('function');
      const result = controller.getMethod();
      expect(result.message).toBe('Hello from utils');
    });

    it('should preserve method context after binding', () => {
      const controller = new UtilsTestController();
      bindClassMethods(controller);

      const result = controller.getMethod();
      expect(result.message).toBe('Hello from utils');

      // Test that context is preserved
      controller.updateMessage('Updated message');
      const updatedResult = controller.getMethod();
      expect(updatedResult.message).toBe('Updated message');
    });

    it('should handle empty controllers gracefully', () => {
      class EmptyController {}
      const controller = new EmptyController();

      expect(() => {
        bindClassMethods(controller);
      }).not.toThrow();
    });
  });

  describe('normalizeRoutePath', () => {
    it('should normalize simple route paths', () => {
      expect(normalizeRoutePath('/users')).toBe('/users');
      expect(normalizeRoutePath('users')).toBe('/users');
      expect(normalizeRoutePath('/users/')).toBe('/users');
      expect(normalizeRoutePath('')).toBe(''); // Empty string stays empty
    });

    it('should handle complex route paths', () => {
      expect(normalizeRoutePath('/api/v1/users')).toBe('/api/v1/users');
      expect(normalizeRoutePath('api/v1/users/')).toBe('/api/v1/users');
      // Note: normalizeRoutePath removes only one trailing slash per call
      expect(normalizeRoutePath('//api//v1//users//')).toBe('//api//v1//users/');
    });

    it('should handle route parameters', () => {
      expect(normalizeRoutePath('/users/:id')).toBe('/users/:id');
      expect(normalizeRoutePath('/users/:id/posts/:postId')).toBe('/users/:id/posts/:postId');
      expect(normalizeRoutePath('users/:id/')).toBe('/users/:id');
    });

    it('should handle wildcard routes', () => {
      expect(normalizeRoutePath('/api/*')).toBe('/api/*');
      expect(normalizeRoutePath('static/*')).toBe('/static/*');
    });
  });

  describe('mapController', () => {
    it('should map controller and return route metadata', () => {
      // mapController expects a class constructor, not an instance
      expect(() => {
        const mapped = mapController(UtilsTestController as any);
        expect(Array.isArray(mapped)).toBe(true);
      }).not.toThrow();
    });

    it('should handle controller with metadata', () => {
      // The controller should have metadata from the @KickController decorator
      expect(UtilsTestController.name).toBe('UtilsTestController');
      
      expect(() => {
        const routes = mapController(UtilsTestController as any);
        expect(Array.isArray(routes)).toBe(true);
      }).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle null/undefined inputs gracefully for normalizeRoutePath', () => {
      // These should either handle gracefully or throw expected errors
      expect(() => {
        normalizeRoutePath(null as any);
      }).toThrow();

      expect(() => {
        normalizeRoutePath(undefined as any);
      }).toThrow();
    });

    it('should handle empty strings and edge values', () => {
      expect(normalizeRoutePath('')).toBe(''); // Empty string stays empty
      expect(normalizeRoutePath('/')).toBe('');  // Single slash becomes empty after removing trailing slash
      expect(normalizeRoutePath('//')).toBe('/'); // Double slash becomes single slash after removing trailing
    });

    it('should preserve special characters in routes', () => {
      expect(normalizeRoutePath('/api/v1/users?search=test')).toBe('/api/v1/users?search=test');
      expect(normalizeRoutePath('/api/v1/users#section')).toBe('/api/v1/users#section');
    });
  });

  describe('Integration with Decorators', () => {
    it('should work with decorated controllers', () => {
      @KickController('/decorated')
      class DecoratedController {
        method1() {
          return 'method1';
        }

        method2() {
          return 'method2';
        }
      }

      const controller = new DecoratedController();
      
      expect(() => {
        bindClassMethods(controller);
        expect(controller.method1()).toBe('method1');
        expect(controller.method2()).toBe('method2');
      }).not.toThrow();

      expect(() => {
        const routes = mapController(DecoratedController as any);
        expect(Array.isArray(routes)).toBe(true);
      }).not.toThrow();
    });

    it('should validate bound methods maintain context', () => {
      class ContextTestController {
        private value = 'initial';

        getValue() {
          return this.value;
        }

        setValue(newValue: string) {
          this.value = newValue;
        }
      }

      const controller = new ContextTestController();
      bindClassMethods(controller);

      // Extract method to test context binding
      const getValue = controller.getValue;
      const setValue = controller.setValue;

      expect(getValue()).toBe('initial');
      setValue('updated');
      expect(getValue()).toBe('updated');
    });
  });
});
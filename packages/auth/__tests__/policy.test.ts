import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'reflect-metadata'
import { Policy, AuthorizationService, policyRegistry } from '../src/policy'
import { AuthAdapter, Can, type AuthStrategy } from '@forinda/kickjs-auth'
import { Controller, Delete, Get } from '@forinda/kickjs'

describe('Policy & AuthorizationService', () => {
  beforeEach(() => {
    policyRegistry.clear()
  })

  it('@Policy registers class in the global registry', () => {
    @Policy('post')
    class PostPolicy {
      view() {
        return true
      }
    }

    expect(policyRegistry.has('post')).toBe(true)
    expect(policyRegistry.get('post')).toBe(PostPolicy)
  })

  it('AuthorizationService.can() calls the correct policy method', async () => {
    @Policy('article')
    class ArticlePolicy {
      view(_user: any) {
        return true
      }
      delete(user: any) {
        return user.roles?.includes('admin')
      }
    }

    const authz = new AuthorizationService()
    const admin = { id: '1', roles: ['admin'] }
    const user = { id: '2', roles: ['user'] }

    expect(await authz.can(admin, 'view', 'article')).toBe(true)
    expect(await authz.can(admin, 'delete', 'article')).toBe(true)
    expect(await authz.can(user, 'delete', 'article')).toBe(false)
  })

  it('returns false for unknown resource', async () => {
    const authz = new AuthorizationService()
    expect(await authz.can({ id: '1' }, 'view', 'nonexistent')).toBe(false)
  })

  it('returns false for unknown action', async () => {
    @Policy('item')
    class ItemPolicy {
      view() {
        return true
      }
    }

    const authz = new AuthorizationService()
    expect(await authz.can({ id: '1' }, 'destroy', 'item')).toBe(false)
  })

  it('policy method receives resource instance', async () => {
    @Policy('comment')
    class CommentPolicy {
      update(user: any, comment: any) {
        return user.id === comment.authorId
      }
    }

    const authz = new AuthorizationService()
    const user = { id: 'u1' }
    const ownComment = { authorId: 'u1', text: 'hello' }
    const otherComment = { authorId: 'u2', text: 'world' }

    expect(await authz.can(user, 'update', 'comment', ownComment)).toBe(true)
    expect(await authz.can(user, 'update', 'comment', otherComment)).toBe(false)
  })

  describe('@Can() in controllers via AuthAdapter', () => {
    const alwaysAuth: AuthStrategy = {
      name: 'test',
      validate: async () => ({ id: 'user-1', roles: ['user'] }),
    }

    it('@Can() allows when policy returns true', async () => {
      @Policy('task')
      class TaskPolicy {
        view() {
          return true
        }
      }

      @Controller()
      class TaskCtrl {
        @Get('/tasks')
        @Can('view', 'task')
        list() {}
      }

      const adapter = new AuthAdapter({
        strategies: [alwaysAuth],
        defaultPolicy: 'protected',
      })
      adapter.onRouteMount!(TaskCtrl, '/api')

      const handler = adapter.middleware!()[0].handler
      const req = { method: 'GET', path: '/api/tasks', baseUrl: '', headers: {}, ip: '1.1.1.1', url: '/api/tasks' }
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() }
      const next = vi.fn()

      await handler(req, res, next)
      expect(next).toHaveBeenCalled()
    })

    it('@Can() blocks when policy returns false', async () => {
      @Policy('secret')
      class SecretPolicy {
        delete(user: any) {
          return user.roles?.includes('admin')
        }
      }

      @Controller()
      class SecretCtrl {
        @Delete('/secrets')
        @Can('delete', 'secret')
        remove() {}
      }

      const adapter = new AuthAdapter({
        strategies: [alwaysAuth], // user has ['user'] role, not admin
        defaultPolicy: 'protected',
      })
      adapter.onRouteMount!(SecretCtrl, '/api')

      const handler = adapter.middleware!()[0].handler
      const req = { method: 'DELETE', path: '/api/secrets', baseUrl: '', headers: {}, ip: '1.1.1.1', url: '/api/secrets' }
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() }
      const next = vi.fn()

      await handler(req, res, next)
      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(403)
    })
  })
})

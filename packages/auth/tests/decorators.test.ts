import { describe, it, expect } from 'vitest'
import 'reflect-metadata'
import { Authenticated, Public, Roles, AUTH_META } from '@forinda/kickjs-auth'

describe('@Authenticated', () => {
  it('marks a class as requiring auth', () => {
    @Authenticated()
    class Ctrl {}

    expect(Reflect.getMetadata(AUTH_META.AUTHENTICATED, Ctrl)).toBe(true)
  })

  it('marks a method as requiring auth', () => {
    class Ctrl {
      @Authenticated()
      secret() {}
    }

    expect(Reflect.getMetadata(AUTH_META.AUTHENTICATED, Ctrl, 'secret')).toBe(true)
  })

  it('stores strategy name on class', () => {
    @Authenticated('api-key')
    class Ctrl {}

    expect(Reflect.getMetadata(AUTH_META.STRATEGY, Ctrl)).toBe('api-key')
  })

  it('stores strategy name on method', () => {
    class Ctrl {
      @Authenticated('jwt')
      secure() {}
    }

    expect(Reflect.getMetadata(AUTH_META.STRATEGY, Ctrl, 'secure')).toBe('jwt')
  })
})

describe('@Public', () => {
  it('marks a method as public', () => {
    class Ctrl {
      @Public()
      open() {}
    }

    expect(Reflect.getMetadata(AUTH_META.PUBLIC, Ctrl, 'open')).toBe(true)
  })
})

describe('@Roles', () => {
  it('stores required roles and implies @Authenticated', () => {
    class Ctrl {
      @Roles('admin', 'superadmin')
      manage() {}
    }

    expect(Reflect.getMetadata(AUTH_META.ROLES, Ctrl, 'manage')).toEqual(['admin', 'superadmin'])
    expect(Reflect.getMetadata(AUTH_META.AUTHENTICATED, Ctrl, 'manage')).toBe(true)
  })
})

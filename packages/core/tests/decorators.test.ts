import { describe, it, expect, beforeEach } from 'vitest'
import 'reflect-metadata'
import {
  Container,
  Scope,
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Middleware,
  FileUpload,
  ApiQueryParams,
  Builder,
  PostConstruct,
  Service,
  Component,
  Repository,
  Autowired,
  Inject,
  Value,
  METADATA,
  type RouteDefinition,
} from '@forinda/kickjs-core'

describe('Class Decorators', () => {
  beforeEach(() => {
    Container.reset()
  })

  it('@Controller sets path metadata', () => {
    @Controller('/users')
    class UserController {}

    const path = Reflect.getMetadata(METADATA.CONTROLLER_PATH, UserController)
    expect(path).toBe('/users')
  })

  it('@Controller defaults to / when no path provided', () => {
    @Controller()
    class RootController {}

    const path = Reflect.getMetadata(METADATA.CONTROLLER_PATH, RootController)
    expect(path).toBe('/')
  })

  it('@Service marks class as injectable', () => {
    @Service()
    class MyService {}

    expect(Reflect.getMetadata(METADATA.INJECTABLE, MyService)).toBe(true)
    expect(Reflect.getMetadata(METADATA.SCOPE, MyService)).toBe(Scope.SINGLETON)
  })

  it('@Component marks class as injectable', () => {
    @Component()
    class MyComponent {}

    expect(Reflect.getMetadata(METADATA.INJECTABLE, MyComponent)).toBe(true)
  })

  it('@Repository marks class as injectable', () => {
    @Repository()
    class MyRepo {}

    expect(Reflect.getMetadata(METADATA.INJECTABLE, MyRepo)).toBe(true)
  })

})

describe('HTTP Route Decorators', () => {
  it('@Get registers a GET route', () => {
    class Ctrl {
      @Get('/list')
      list() {}
    }

    const routes: RouteDefinition[] = Reflect.getMetadata(METADATA.ROUTES, Ctrl)
    expect(routes).toHaveLength(1)
    expect(routes[0]).toMatchObject({ method: 'GET', path: '/list', handlerName: 'list' })
  })

  it('@Post registers a POST route', () => {
    class Ctrl {
      @Post('/create')
      create() {}
    }

    const routes: RouteDefinition[] = Reflect.getMetadata(METADATA.ROUTES, Ctrl)
    expect(routes[0]).toMatchObject({ method: 'POST', path: '/create' })
  })

  it('@Put registers a PUT route', () => {
    class Ctrl {
      @Put('/:id')
      update() {}
    }

    const routes: RouteDefinition[] = Reflect.getMetadata(METADATA.ROUTES, Ctrl)
    expect(routes[0]).toMatchObject({ method: 'PUT', path: '/:id' })
  })

  it('@Delete registers a DELETE route', () => {
    class Ctrl {
      @Delete('/:id')
      remove() {}
    }

    const routes: RouteDefinition[] = Reflect.getMetadata(METADATA.ROUTES, Ctrl)
    expect(routes[0]).toMatchObject({ method: 'DELETE', path: '/:id' })
  })

  it('@Patch registers a PATCH route', () => {
    class Ctrl {
      @Patch('/:id')
      patch() {}
    }

    const routes: RouteDefinition[] = Reflect.getMetadata(METADATA.ROUTES, Ctrl)
    expect(routes[0]).toMatchObject({ method: 'PATCH', path: '/:id' })
  })

  it('defaults path to / when omitted', () => {
    class Ctrl {
      @Get()
      index() {}
    }

    const routes: RouteDefinition[] = Reflect.getMetadata(METADATA.ROUTES, Ctrl)
    expect(routes[0].path).toBe('/')
  })

  it('supports validation schema in route', () => {
    const bodySchema = { type: 'object' }
    class Ctrl {
      @Post('/create', { body: bodySchema, name: 'CreateUser' })
      create() {}
    }

    const routes: RouteDefinition[] = Reflect.getMetadata(METADATA.ROUTES, Ctrl)
    expect(routes[0].validation?.body).toBe(bodySchema)
    expect(routes[0].validation?.name).toBe('CreateUser')
  })

  it('registers multiple routes on one class', () => {
    class Ctrl {
      @Get('/') list() {}
      @Post('/') create() {}
      @Get('/:id') findOne() {}
    }

    const routes: RouteDefinition[] = Reflect.getMetadata(METADATA.ROUTES, Ctrl)
    expect(routes).toHaveLength(3)
  })
})

describe('@Middleware', () => {
  it('attaches class-level middleware', () => {
    const guard = () => {}

    @Middleware(guard)
    class Ctrl {}

    const middlewares = Reflect.getMetadata(METADATA.CLASS_MIDDLEWARES, Ctrl)
    expect(middlewares).toContain(guard)
  })

  it('attaches method-level middleware', () => {
    const auth = () => {}

    class Ctrl {
      @Middleware(auth)
      secret() {}
    }

    const middlewares = Reflect.getMetadata(METADATA.METHOD_MIDDLEWARES, Ctrl, 'secret')
    expect(middlewares).toContain(auth)
  })

  it('stacks multiple middleware', () => {
    const a = () => {}
    const b = () => {}

    @Middleware(a, b)
    class Ctrl {}

    const middlewares = Reflect.getMetadata(METADATA.CLASS_MIDDLEWARES, Ctrl)
    expect(middlewares).toHaveLength(2)
  })
})

describe('@FileUpload', () => {
  it('sets file upload metadata', () => {
    class Ctrl {
      @FileUpload({ mode: 'single', fieldName: 'avatar', maxSize: 2 * 1024 * 1024 })
      upload() {}
    }

    const config = Reflect.getMetadata(METADATA.FILE_UPLOAD, Ctrl, 'upload')
    expect(config.mode).toBe('single')
    expect(config.fieldName).toBe('avatar')
    expect(config.maxSize).toBe(2 * 1024 * 1024)
  })

  it('supports array mode', () => {
    class Ctrl {
      @FileUpload({ mode: 'array', maxCount: 5 })
      uploadMany() {}
    }

    const config = Reflect.getMetadata(METADATA.FILE_UPLOAD, Ctrl, 'uploadMany')
    expect(config.mode).toBe('array')
    expect(config.maxCount).toBe(5)
  })
})

describe('@ApiQueryParams', () => {
  it('stores query params config', () => {
    class Ctrl {
      @ApiQueryParams({
        filterable: ['status', 'category'],
        sortable: ['name', 'createdAt'],
        searchable: ['name'],
      })
      @Get('/')
      list() {}
    }

    const config = Reflect.getMetadata(METADATA.QUERY_PARAMS, Ctrl, 'list')
    expect(config.filterable).toEqual(['status', 'category'])
    expect(config.sortable).toEqual(['name', 'createdAt'])
    expect(config.searchable).toEqual(['name'])
  })
})

describe('@Builder', () => {
  it('adds a static builder() method', () => {
    @Builder
    class User {
      name!: string
      age!: number
    }

    const user = (User as any).builder().name('Alice').age(30).build()
    expect(user).toBeInstanceOf(User)
    expect(user.name).toBe('Alice')
    expect(user.age).toBe(30)
  })
})

describe('@PostConstruct', () => {
  it('stores post-construct method name', () => {
    class Svc {
      @PostConstruct()
      init() {}
    }

    const methodName = Reflect.getMetadata(METADATA.POST_CONSTRUCT, Svc.prototype)
    expect(methodName).toBe('init')
  })
})

describe('@Autowired', () => {
  it('stores autowired metadata', () => {
    class Dep {}

    class Svc {
      @Autowired(Dep)
      dep!: Dep
    }

    const map: Map<string, any> = Reflect.getMetadata(METADATA.AUTOWIRED, Svc.prototype)
    expect(map.get('dep')).toBe(Dep)
  })
})

describe('@Inject', () => {
  it('stores inject metadata on constructor params', () => {
    const TOKEN = Symbol('token')

    class Svc {
      constructor(@Inject(TOKEN) private dep: any) {}
    }

    const injections = Reflect.getMetadata(METADATA.INJECT, Svc)
    expect(injections[0]).toBe(TOKEN)
  })
})

describe('@Value', () => {
  it('stores value metadata for env injection', () => {
    class Svc {
      @Value('DATABASE_URL', 'sqlite://default')
      dbUrl!: string
    }

    const map: Map<string, any> = Reflect.getMetadata(METADATA.VALUE, Svc.prototype)
    const entry = map.get('dbUrl')
    expect(entry.envKey).toBe('DATABASE_URL')
    expect(entry.defaultValue).toBe('sqlite://default')
  })
})

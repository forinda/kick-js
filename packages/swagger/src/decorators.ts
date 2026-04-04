import { setMethodMeta, setClassMeta, pushMethodMeta } from '@forinda/kickjs'

const SWAGGER_KEYS = {
  OPERATION: Symbol('kick:swagger:operation'),
  RESPONSES: Symbol('kick:swagger:responses'),
  TAGS: Symbol('kick:swagger:tags'),
  BEARER_AUTH: Symbol('kick:swagger:bearer'),
  EXCLUDE: Symbol('kick:swagger:exclude'),
}

export { SWAGGER_KEYS }

export interface ApiOperationOptions {
  summary?: string
  description?: string
  operationId?: string
  deprecated?: boolean
}

export interface ApiResponseOptions {
  status: number
  description?: string
  schema?: any
  /** Schema name in components/schemas (e.g., 'UserResponse', 'ErrorBody'). Auto-generated from handler name if omitted. */
  name?: string
}

/** Attach operation metadata to a route handler */
export function ApiOperation(options: ApiOperationOptions): MethodDecorator {
  return (target, propertyKey) => {
    setMethodMeta(SWAGGER_KEYS.OPERATION, options, target.constructor, propertyKey as string)
  }
}

/** Document a response status. Can be stacked multiple times. */
export function ApiResponse(options: ApiResponseOptions): MethodDecorator {
  return (target, propertyKey) => {
    pushMethodMeta<ApiResponseOptions>(
      SWAGGER_KEYS.RESPONSES,
      target.constructor,
      propertyKey as string,
      options,
    )
  }
}

/** Apply OpenAPI tags at class or method level */
export function ApiTags(...tags: string[]): ClassDecorator & MethodDecorator {
  return (target: any, propertyKey?: string | symbol) => {
    if (propertyKey) {
      setMethodMeta(SWAGGER_KEYS.TAGS, tags, target.constructor, propertyKey as string)
    } else {
      setClassMeta(SWAGGER_KEYS.TAGS, tags, target)
    }
  }
}

/** Mark endpoint as requiring Bearer token auth */
export function ApiBearerAuth(name = 'BearerAuth'): ClassDecorator & MethodDecorator {
  return (target: any, propertyKey?: string | symbol) => {
    if (propertyKey) {
      setMethodMeta(SWAGGER_KEYS.BEARER_AUTH, name, target.constructor, propertyKey as string)
    } else {
      setClassMeta(SWAGGER_KEYS.BEARER_AUTH, name, target)
    }
  }
}

/** Exclude a controller or method from the OpenAPI spec */
export function ApiExclude(): ClassDecorator & MethodDecorator {
  return (target: any, propertyKey?: string | symbol) => {
    if (propertyKey) {
      setMethodMeta(SWAGGER_KEYS.EXCLUDE, true, target.constructor, propertyKey as string)
    } else {
      setClassMeta(SWAGGER_KEYS.EXCLUDE, true, target)
    }
  }
}

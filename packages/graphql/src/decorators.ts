import 'reflect-metadata'

const RESOLVER_META = Symbol('gql:resolver')
const QUERY_META = Symbol('gql:query')
const MUTATION_META = Symbol('gql:mutation')
const SUBSCRIPTION_META = Symbol('gql:subscription')
const FIELD_META = Symbol('gql:field')
const ARG_META = Symbol('gql:arg')

export interface ResolverMeta {
  typeName?: string
}

export interface FieldMeta {
  name: string
  handlerName: string
  returnType?: string
  description?: string
}

export interface ArgMeta {
  paramIndex: number
  name: string
  type?: string
}

/**
 * Mark a class as a GraphQL resolver.
 * Optionally bind to a specific type (e.g., `@Resolver('User')`).
 */
export function Resolver(typeName?: string): ClassDecorator {
  return (target: any) => {
    Reflect.defineMetadata(
      RESOLVER_META,
      { typeName: typeName ?? target.name.replace('Resolver', '') },
      target,
    )
  }
}

/** Define a Query field */
export function Query(
  name?: string,
  options?: { description?: string; returnType?: string },
): MethodDecorator {
  return (target, propertyKey) => {
    const existing: FieldMeta[] = Reflect.getMetadata(QUERY_META, target.constructor) ?? []
    existing.push({
      name: name ?? (propertyKey as string),
      handlerName: propertyKey as string,
      returnType: options?.returnType,
      description: options?.description,
    })
    Reflect.defineMetadata(QUERY_META, existing, target.constructor)
  }
}

/** Define a Mutation field */
export function Mutation(
  name?: string,
  options?: { description?: string; returnType?: string },
): MethodDecorator {
  return (target, propertyKey) => {
    const existing: FieldMeta[] = Reflect.getMetadata(MUTATION_META, target.constructor) ?? []
    existing.push({
      name: name ?? (propertyKey as string),
      handlerName: propertyKey as string,
      returnType: options?.returnType,
      description: options?.description,
    })
    Reflect.defineMetadata(MUTATION_META, existing, target.constructor)
  }
}

/** Define a Subscription field */
export function Subscription(name?: string, options?: { description?: string }): MethodDecorator {
  return (target, propertyKey) => {
    const existing: FieldMeta[] = Reflect.getMetadata(SUBSCRIPTION_META, target.constructor) ?? []
    existing.push({
      name: name ?? (propertyKey as string),
      handlerName: propertyKey as string,
      description: options?.description,
    })
    Reflect.defineMetadata(SUBSCRIPTION_META, existing, target.constructor)
  }
}

/** Mark a method parameter as a GraphQL argument */
export function Arg(name: string, type?: string): ParameterDecorator {
  return (target, propertyKey, paramIndex) => {
    const key = propertyKey as string
    const existing: ArgMeta[] = Reflect.getMetadata(ARG_META, target.constructor, key) ?? []
    existing.push({ paramIndex, name, type })
    Reflect.defineMetadata(ARG_META, existing, target.constructor, key)
  }
}

// Re-export metadata keys for the adapter
export { RESOLVER_META, QUERY_META, MUTATION_META, SUBSCRIPTION_META, FIELD_META, ARG_META }

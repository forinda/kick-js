import { setClassMeta, pushClassMeta, pushMethodMeta } from '@forinda/kickjs'

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
    setClassMeta(
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
    pushClassMeta<FieldMeta>(QUERY_META, target.constructor, {
      name: name ?? (propertyKey as string),
      handlerName: propertyKey as string,
      returnType: options?.returnType,
      description: options?.description,
    })
  }
}

/** Define a Mutation field */
export function Mutation(
  name?: string,
  options?: { description?: string; returnType?: string },
): MethodDecorator {
  return (target, propertyKey) => {
    pushClassMeta<FieldMeta>(MUTATION_META, target.constructor, {
      name: name ?? (propertyKey as string),
      handlerName: propertyKey as string,
      returnType: options?.returnType,
      description: options?.description,
    })
  }
}

/** Define a Subscription field */
export function Subscription(name?: string, options?: { description?: string }): MethodDecorator {
  return (target, propertyKey) => {
    pushClassMeta<FieldMeta>(SUBSCRIPTION_META, target.constructor, {
      name: name ?? (propertyKey as string),
      handlerName: propertyKey as string,
      description: options?.description,
    })
  }
}

/** Mark a method parameter as a GraphQL argument */
export function Arg(name: string, type?: string): ParameterDecorator {
  return (target, propertyKey, paramIndex) => {
    const key = propertyKey as string
    pushMethodMeta<ArgMeta>(ARG_META, target.constructor, key, { paramIndex, name, type })
  }
}

// Re-export metadata keys for the adapter
export { RESOLVER_META, QUERY_META, MUTATION_META, SUBSCRIPTION_META, FIELD_META, ARG_META }

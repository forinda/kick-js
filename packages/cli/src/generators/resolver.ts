import { join } from 'node:path'
import { writeFileSafe } from '../utils/fs'
import { toPascalCase, toKebabCase, toCamelCase } from '../utils/naming'

interface GenerateResolverOptions {
  name: string
  outDir: string
}

export async function generateResolver(options: GenerateResolverOptions): Promise<string[]> {
  const { name, outDir } = options
  const pascal = toPascalCase(name)
  const kebab = toKebabCase(name)
  const camel = toCamelCase(name)
  const files: string[] = []

  const write = async (relativePath: string, content: string) => {
    const fullPath = join(outDir, relativePath)
    await writeFileSafe(fullPath, content)
    files.push(fullPath)
  }

  await write(
    `${kebab}.resolver.ts`,
    `import { Service } from '@forinda/kickjs'
import { Resolver, Query, Mutation, Arg } from '@forinda/kickjs-graphql'

/**
 * ${pascal} GraphQL Resolver
 *
 * Decorators:
 *   @Resolver(typeName?) — marks this class as a GraphQL resolver
 *   @Query(name?, { returnType?, description? }) — defines a query field
 *   @Mutation(name?, { returnType?, description? }) — defines a mutation field
 *   @Arg(name, type?) — marks a method parameter as a GraphQL argument
 */
@Service()
@Resolver('${pascal}')
export class ${pascal}Resolver {
  private items: Array<{ id: string; name: string }> = []

  @Query('${camel}s', { returnType: '[${pascal}]', description: 'List all ${camel}s' })
  findAll() {
    return this.items
  }

  @Query('${camel}', { returnType: '${pascal}', description: 'Get a ${camel} by ID' })
  findById(@Arg('id', 'ID!') id: string) {
    return this.items.find((item) => item.id === id) ?? null
  }

  @Mutation('create${pascal}', { returnType: '${pascal}', description: 'Create a new ${camel}' })
  create(@Arg('name', 'String!') name: string) {
    const item = { id: String(this.items.length + 1), name }
    this.items.push(item)
    return item
  }

  @Mutation('update${pascal}', { returnType: '${pascal}', description: 'Update a ${camel}' })
  update(@Arg('id', 'ID!') id: string, @Arg('name', 'String!') name: string) {
    const item = this.items.find((i) => i.id === id)
    if (item) item.name = name
    return item
  }

  @Mutation('delete${pascal}', { returnType: 'Boolean', description: 'Delete a ${camel}' })
  remove(@Arg('id', 'ID!') id: string) {
    const idx = this.items.findIndex((i) => i.id === id)
    if (idx === -1) return false
    this.items.splice(idx, 1)
    return true
  }
}
`,
  )

  await write(
    `${kebab}.typedefs.ts`,
    `/**
 * ${pascal} GraphQL type definitions.
 * Pass to GraphQLAdapter's typeDefs option to register custom types.
 */
export const ${camel}TypeDefs = \`
  type ${pascal} {
    id: ID!
    name: String!
  }
\`
`,
  )

  return files
}

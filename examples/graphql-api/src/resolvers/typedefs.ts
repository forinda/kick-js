/**
 * Custom GraphQL type definitions.
 * Only define custom types here — Query and Mutation are auto-generated
 * from @Query and @Mutation decorators on resolver classes.
 */
export const typeDefs = `
  type User {
    id: ID!
    name: String!
    email: String!
    role: String!
  }

  type Post {
    id: ID!
    title: String!
    content: String!
    authorId: ID!
  }
`

# GraphQL Example

GraphQL API with `@Resolver`, `@Query`, `@Mutation` decorators and GraphiQL playground.

## Features

- User and Post resolvers with CRUD operations
- In-memory data with seed records
- Custom type definitions (User, Post)
- GraphiQL playground at `/graphql`
- DevTools dashboard at `/_debug`

## Running

```bash
cd examples/graphql-api
kick dev
```

Then open `http://localhost:3000/graphql` for the GraphiQL playground.

## Example Queries

```graphql
# List all users
query { users { id name email role } }

# Get user by ID
query { user(id: "1") { name email } }

# Create a user
mutation { createUser(name: "Alice", email: "alice@example.com") { id name } }

# List posts
query { posts { id title content author { name } } }
```

## Source

- [examples/graphql-api/](https://github.com/forinda/kick-js/tree/main/examples/graphql-api)
- Created with: `kick new graphql-api --template graphql`

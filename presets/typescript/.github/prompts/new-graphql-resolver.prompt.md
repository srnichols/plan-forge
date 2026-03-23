---
description: "Scaffold an Apollo Server GraphQL resolver with typeDefs, queries, mutations, and DataLoader patterns."
agent: "agent"
tools: [read, edit, search]
---
# Create New GraphQL Resolver

Scaffold a GraphQL resolver using Apollo Server with type definitions, resolvers, and DataLoader.

## Required Pattern

### Type Definitions
```typescript
import { gql } from 'graphql-tag';

export const {entityName}TypeDefs = gql`
  type {EntityName} {
    id: ID!
    name: String!
    description: String
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  input Create{EntityName}Input {
    name: String!
    description: String
  }

  input Update{EntityName}Input {
    name: String!
    description: String
  }

  extend type Query {
    {entityName}(id: ID!): {EntityName}
    {entityName}s(page: Int, pageSize: Int): {EntityName}Connection!
  }

  extend type Mutation {
    create{EntityName}(input: Create{EntityName}Input!): {EntityName}!
    update{EntityName}(id: ID!, input: Update{EntityName}Input!): {EntityName}!
    delete{EntityName}(id: ID!): Boolean!
  }
`;
```

### Resolvers
```typescript
import { Resolvers } from '../generated/graphql';

export const {entityName}Resolvers: Resolvers = {
  Query: {
    {entityName}: async (_parent, { id }, { dataSources }) => {
      return dataSources.{entityName}Service.findById(id);
    },
    {entityName}s: async (_parent, { page = 1, pageSize = 20 }, { dataSources }) => {
      return dataSources.{entityName}Service.findPaged(page, pageSize);
    },
  },

  Mutation: {
    create{EntityName}: async (_parent, { input }, { dataSources }) => {
      return dataSources.{entityName}Service.create(input);
    },
    update{EntityName}: async (_parent, { id, input }, { dataSources }) => {
      return dataSources.{entityName}Service.update(id, input);
    },
    delete{EntityName}: async (_parent, { id }, { dataSources }) => {
      return dataSources.{entityName}Service.delete(id);
    },
  },

  // Nested field resolver
  {EntityName}: {
    relatedItems: async (parent, _args, { loaders }) => {
      return loaders.{entityName}Items.load(parent.id);
    },
  },
};
```

### DataLoader (N+1 Prevention)
```typescript
import DataLoader from 'dataloader';

export function create{EntityName}Loader(service: {EntityName}Service) {
  return new DataLoader<string, {EntityName} | null>(async (ids) => {
    const items = await service.findByIds(ids as string[]);
    const map = new Map(items.map((item) => [item.id, item]));
    return ids.map((id) => map.get(id) ?? null);
  });
}
```

### Context Setup
```typescript
export interface GraphQLContext {
  dataSources: {
    {entityName}Service: {EntityName}Service;
  };
  loaders: {
    {entityName}Items: DataLoader<string, {EntityName}Item[]>;
  };
}

const server = new ApolloServer({ typeDefs, resolvers });

const { url } = await startStandaloneServer(server, {
  context: async ({ req }): Promise<GraphQLContext> => ({
    dataSources: {
      {entityName}Service: new {EntityName}Service(db),
    },
    loaders: {
      {entityName}Items: create{EntityName}Loader(service),
    },
  }),
});
```

### Input Validation
```typescript
import { UserInputError } from '@apollo/server';
import { z } from 'zod';

const create{EntityName}Schema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});

// Validate inside the resolver
create{EntityName}: async (_parent, { input }, { dataSources }) => {
  const result = create{EntityName}Schema.safeParse(input);
  if (!result.success) {
    throw new UserInputError('Invalid input', { errors: result.error.flatten() });
  }
  return dataSources.{entityName}Service.create(result.data);
},
```

## Rules

- ALWAYS use DataLoaders for related entity resolution — never query inside field resolvers
- Resolvers should be thin — delegate to services for business logic
- Validate inputs with Zod inside resolvers — GraphQL type system alone is not enough
- Create a fresh DataLoader per request (in context factory) — never reuse across requests
- Use `dataSources` pattern for service injection, `loaders` for DataLoader injection
- Keep type definitions and resolvers co-located per entity in `src/graphql/`

## Reference Files

- [GraphQL patterns](../instructions/graphql-patterns.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)

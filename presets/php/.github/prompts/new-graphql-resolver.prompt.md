---
description: "Scaffold a Lighthouse GraphQL resolver with schema-first SDL, guards, policy directives, pagination, and batch loading."
agent: "agent"
tools: [read, edit, search]
---
# Create New GraphQL Resolver

Scaffold a Lighthouse resolver for `{EntityName}`. Use schema-first SDL and Laravel services; do not put business rules in resolver classes.

## Required Pattern

### SDL Template
```text
type {EntityName} {
  id: ID!
  name: String!
  description: String
  createdAt: DateTime! @rename(attribute: "created_at")
  updatedAt: DateTime! @rename(attribute: "updated_at")
}

extend type Query {
  {entityName}(id: ID! @eq): {EntityName}
    @guard(with: ["sanctum"])
    @canFind(ability: "view", find: "id")
    @field(resolver: "App\\GraphQL\\Queries\\{EntityName}Query")

  {entityName}s: [{EntityName}!]!
    @guard(with: ["sanctum"])
    @canModel(ability: "viewAny", model: "App\\Models\\{EntityName}")
    @paginate(type: CONNECTION, model: "App\\Models\\{EntityName}", defaultCount: 25, maxCount: 100)
}

extend type Mutation {
  create{EntityName}(input: Create{EntityName}Input! @spread): {EntityName}!
    @guard(with: ["sanctum"])
    @canModel(ability: "create", model: "App\\Models\\{EntityName}")
    @field(resolver: "App\\GraphQL\\Mutations\\Create{EntityName}")
}

input Create{EntityName}Input {
  name: String!
  description: String
}
```

### Mutation Resolver Template
```text
<?php

declare(strict_types=1);

namespace App\GraphQL\Mutations;

use App\Data\Create{EntityName}Data;
use App\Models\{EntityName};
use App\Services\{EntityName}Service;

final readonly class Create{EntityName}
{
    public function __construct(private {EntityName}Service $service)
    {
    }

    public function __invoke(null $_, array $args): {EntityName}
    {
        return $this->service->create(new Create{EntityName}Data(
            name: $args['name'],
            description: $args['description'] ?? null,
        ));
    }
}
```

### Batch Loader Template
```text
Create a loader under app/GraphQL/Loaders that accepts a list of IDs, runs one tenant-scoped repository query, keys results by ID, and returns them in the same order requested.
```

## Rules

- Use `@guard` and current Lighthouse policy directives (`@canFind`, `@canModel`, `@canQuery`, `@canResolved`, `@canRoot`).
- Configure Lighthouse with `guards => ['sanctum']` and route middleware `[AttemptAuthentication::class, ResolveTenant::class]`.
- Escape PHP namespaces in SDL strings with doubled backslashes.
- Every list field is paginated and has a `maxCount`.
- Resolvers delegate to services and DTOs; repositories provide query builders.
- Do not accept `tenant_id` in GraphQL input. Tenant scope comes from `CurrentTenant`.
- Add feature tests for auth, authorization, tenant isolation, pagination caps, and N+1 prevention.

## Reference Files

- [GraphQL patterns](../instructions/graphql.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)

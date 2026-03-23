---
description: "Scaffold a Strawberry GraphQL resolver with queries, mutations, DataLoader, and Pydantic integration."
agent: "agent"
tools: [read, edit, search]
---
# Create New GraphQL Resolver

Scaffold a GraphQL resolver using Strawberry with queries, mutations, and DataLoader patterns.

## Required Pattern

### GraphQL Types
```python
import strawberry
from datetime import datetime
from uuid import UUID

@strawberry.type
class {EntityName}Type:
    id: UUID
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime
```

### Input Types
```python
@strawberry.input
class Create{EntityName}Input:
    name: str
    description: str | None = None

@strawberry.input
class Update{EntityName}Input:
    name: str
    description: str | None = None
```

### Query Resolver
```python
@strawberry.type
class {EntityName}Query:
    @strawberry.field
    async def {entity_name}(self, info: strawberry.types.Info, id: UUID) -> {EntityName}Type | None:
        service = info.context["service"]
        entity = await service.find_by_id(id)
        return {EntityName}Type.from_entity(entity) if entity else None

    @strawberry.field
    async def {entity_name}s(
        self, info: strawberry.types.Info, page: int = 1, page_size: int = 20
    ) -> list[{EntityName}Type]:
        service = info.context["service"]
        entities = await service.find_paged(page, page_size)
        return [{EntityName}Type.from_entity(e) for e in entities]
```

### Mutation Resolver
```python
@strawberry.type
class {EntityName}Mutation:
    @strawberry.mutation
    async def create_{entity_name}(
        self, info: strawberry.types.Info, input: Create{EntityName}Input
    ) -> {EntityName}Type:
        service = info.context["service"]
        entity = await service.create(input)
        return {EntityName}Type.from_entity(entity)

    @strawberry.mutation
    async def update_{entity_name}(
        self, info: strawberry.types.Info, id: UUID, input: Update{EntityName}Input
    ) -> {EntityName}Type:
        service = info.context["service"]
        entity = await service.update(id, input)
        return {EntityName}Type.from_entity(entity)
```

### DataLoader (N+1 Prevention)
```python
from strawberry.dataloader import DataLoader

async def load_{entity_name}s(keys: list[UUID]) -> list[{EntityName}Type | None]:
    service = get_service()  # From context or DI
    entities = await service.find_by_ids(keys)
    entity_map = {e.id: {EntityName}Type.from_entity(e) for e in entities}
    return [entity_map.get(key) for key in keys]

# Create per-request in context
def get_context() -> dict:
    return {
        "service": {EntityName}Service(db),
        "{entity_name}_loader": DataLoader(load_fn=load_{entity_name}s),
    }
```

### Mapping from ORM Entity
```python
@strawberry.type
class {EntityName}Type:
    id: UUID
    name: str

    @classmethod
    def from_entity(cls, entity) -> "{EntityName}Type":
        return cls(id=entity.id, name=entity.name)
```

### FastAPI Integration
```python
from strawberry.fastapi import GraphQLRouter

schema = strawberry.Schema(query=Query, mutation=Mutation)
graphql_app = GraphQLRouter(schema, context_getter=get_context)
app.include_router(graphql_app, prefix="/graphql")
```

## Rules

- ALWAYS use DataLoaders for related entity resolution — never query inside field resolvers
- Resolvers should be thin — delegate to services for business logic
- Create a fresh DataLoader per request (in context factory) — never reuse across requests
- Use `@strawberry.input` for mutations — never accept raw dicts
- Map ORM entities to Strawberry types via `from_entity()` class methods
- Keep resolvers in `src/graphql/` organized by entity

## Reference Files

- [GraphQL patterns](../instructions/graphql-patterns.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)

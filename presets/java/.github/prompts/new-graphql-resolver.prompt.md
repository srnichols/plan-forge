---
description: "Scaffold a Spring for GraphQL resolver with @QueryMapping, @MutationMapping, @BatchMapping, and DataLoader."
agent: "agent"
tools: [read, edit, search]
---
# Create New GraphQL Resolver

Scaffold a GraphQL resolver using Spring for GraphQL with annotated controllers and BatchMapping.

## Required Pattern

### Schema (schema.graphqls)
```graphql
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
  {entityName}s(page: Int = 1, pageSize: Int = 20): {EntityName}Connection!
}

extend type Mutation {
  create{EntityName}(input: Create{EntityName}Input!): {EntityName}!
  update{EntityName}(id: ID!, input: Update{EntityName}Input!): {EntityName}!
  delete{EntityName}(id: ID!): Boolean!
}
```

### Query Resolver
```java
@Controller
public class {EntityName}Controller {

    private final {EntityName}Service service;

    public {EntityName}Controller({EntityName}Service service) {
        this.service = service;
    }

    @QueryMapping
    public {EntityName} {entityName}(@Argument UUID id) {
        return service.findById(id)
            .orElseThrow(() -> new NotFoundException("{EntityName}", id));
    }

    @QueryMapping
    public Page<{EntityName}> {entityName}s(
            @Argument int page,
            @Argument int pageSize) {
        return service.findPaged(PageRequest.of(page - 1, pageSize));
    }
}
```

### Mutation Resolver
```java
@Controller
public class {EntityName}MutationController {

    private final {EntityName}Service service;

    public {EntityName}MutationController({EntityName}Service service) {
        this.service = service;
    }

    @MutationMapping
    public {EntityName} create{EntityName}(@Argument @Valid Create{EntityName}Input input) {
        return service.create(input);
    }

    @MutationMapping
    public {EntityName} update{EntityName}(
            @Argument UUID id,
            @Argument @Valid Update{EntityName}Input input) {
        return service.update(id, input);
    }

    @MutationMapping
    public boolean delete{EntityName}(@Argument UUID id) {
        return service.delete(id);
    }
}
```

### BatchMapping (N+1 Prevention)
```java
@Controller
public class OrderGraphQLController {

    private final {EntityName}Service service;

    @BatchMapping
    public Map<Order, {EntityName}> {entityName}(List<Order> orders) {
        List<UUID> ids = orders.stream()
            .map(Order::get{EntityName}Id)
            .collect(Collectors.toList());

        Map<UUID, {EntityName}> entityMap = service.findByIds(ids).stream()
            .collect(Collectors.toMap({EntityName}::getId, Function.identity()));

        return orders.stream()
            .collect(Collectors.toMap(
                Function.identity(),
                order -> entityMap.get(order.get{EntityName}Id())));
    }
}
```

### Input Record
```java
public record Create{EntityName}Input(
    @NotBlank @Size(max = 200) String name,
    @Size(max = 2000) String description
) {}
```

### Exception Handler
```java
@ControllerAdvice
public class GraphQLExceptionHandler extends DataFetcherExceptionResolverAdapter {

    @Override
    protected GraphQLError resolveToSingleError(Throwable ex, DataFetchingEnvironment env) {
        if (ex instanceof NotFoundException) {
            return GraphqlErrorBuilder.newError(env)
                .message(ex.getMessage())
                .errorType(ErrorType.NOT_FOUND)
                .build();
        }
        return null;  // Fall through to default handling
    }
}
```

## Rules

- ALWAYS use `@BatchMapping` for related entity resolution — never query inside field resolvers
- Resolvers should be thin — delegate to services for business logic
- Use `@Valid` on input arguments for Bean Validation
- Use Spring `@Controller` class per entity — not a single monolithic resolver
- Use `DataFetcherExceptionResolverAdapter` for GraphQL-specific error formatting
- Keep schema files in `src/main/resources/graphql/`
- Keep resolvers in a `graphql/` controller package

## Reference Files

- [GraphQL patterns](../instructions/graphql-patterns.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)

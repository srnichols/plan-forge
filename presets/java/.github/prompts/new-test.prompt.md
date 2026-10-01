---
description: "Scaffold JUnit 6 test classes with MockitoBean, AssertJ, Testcontainers, and proper naming conventions."
agent: "agent"
tools: [read, edit, search, execute]
---
# Create New Test

Scaffold test classes following Spring Boot testing conventions.

## Test Naming Convention

```
{method}_When{Condition}_Should{Expected}
```

## Unit Test Pattern

```java
@ExtendWith(MockitoExtension.class)
class {EntityName}ServiceTest {

    @Mock
    private {EntityName}Repository repository;

    @InjectMocks
    private {EntityName}ServiceImpl service;

    @Test
    void getById_WhenExists_ShouldReturnDto() {
        // Arrange
        var entity = new {EntityName}();
        entity.setId(UUID.randomUUID());
        entity.setName("Test");
        when(repository.findById(entity.getId())).thenReturn(Optional.of(entity));

        // Act
        var result = service.getById(entity.getId());

        // Assert
        assertThat(result).isNotNull();
        assertThat(result.name()).isEqualTo("Test");
        verify(repository).findById(entity.getId());
    }

    @Test
    void getById_WhenNotFound_ShouldThrowNotFoundException() {
        var id = UUID.randomUUID();
        when(repository.findById(id)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.getById(id))
            .isInstanceOf(NotFoundException.class)
            .hasMessageContaining(id.toString());
    }
}
```

## Integration Test Pattern (Testcontainers)

```java
@SpringBootTest
@Testcontainers
class {EntityName}IntegrationTest {

    @Container
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:18-alpine");

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
    }

    @Autowired
    private {EntityName}Repository repository;

    @Test
    void save_ShouldPersistAndRetrieve() {
        var entity = new {EntityName}();
        entity.setName("Integration Test");
        var saved = repository.save(entity);

        var found = repository.findById(saved.getId());
        assertThat(found).isPresent();
        assertThat(found.get().getName()).isEqualTo("Integration Test");
    }
}
```

## Test Categories

| Annotation | When to Use |
|-----------|------------|
| `@Tag("unit")` | Pure unit tests with mocks |
| `@Tag("integration")` | Tests with real DB (Testcontainers) |
| `@Tag("smoke")` | Fast subset for PR validation |

## Reference Files

- [Testing instructions](../instructions/testing.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)

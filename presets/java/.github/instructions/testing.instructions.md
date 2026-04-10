---
description: Java testing patterns — JUnit 5, Testcontainers, MockMvc, Mockito
applyTo: '**/src/test/**,**/*Test*.java,**/*Spec*.java'
---

# Java Testing Patterns

## Tech Stack

- **Unit Tests**: JUnit 5
- **Assertions**: AssertJ (preferred) or JUnit Assert
- **Mocking**: Mockito
- **Integration**: Testcontainers, MockMvc / WebTestClient
- **E2E**: Playwright or Selenium

## Test Types

| Type | Scope | Database | Speed |
|------|-------|----------|-------|
| **Unit** | Single class/method | Mocked | Fast (ms) |
| **Integration** | Service + DB | Real (Testcontainers) | Medium (1-3s) |
| **E2E** | Full HTTP flow | Real | Slow (10s+) |

## Patterns

### Unit Test (JUnit 5 + Mockito)
```java
@ExtendWith(MockitoExtension.class)
class UserServiceTest {

    @Mock
    private UserRepository userRepository;

    @InjectMocks
    private UserService userService;

    @Test
    void getUser_withValidId_returnsUser() {
        // Arrange
        var user = new User(UUID.randomUUID(), "Test User", "test@example.com");
        when(userRepository.findById(user.getId())).thenReturn(Optional.of(user));

        // Act
        var result = userService.getUser(user.getId());

        // Assert
        assertThat(result).isPresent();
        assertThat(result.get().getName()).isEqualTo("Test User");
    }

    @Test
    void getUser_withInvalidId_returnsEmpty() {
        when(userRepository.findById(any())).thenReturn(Optional.empty());

        var result = userService.getUser(UUID.randomUUID());

        assertThat(result).isEmpty();
    }
}
```

### Integration Test (Testcontainers + Spring Boot)
```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
class UsersApiIntegrationTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16")
            .withDatabaseName("testdb");

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
    }

    @Autowired
    private TestRestTemplate restTemplate;

    @Test
    void getUsers_returnsOk() {
        var response = restTemplate.getForEntity("/api/users", String.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    }
}
```

### MockMvc Test (Controller Layer)
```java
@WebMvcTest(UserController.class)
class UserControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private UserService userService;

    @Test
    void getUser_returnsJson() throws Exception {
        var user = new UserDto("Test", "test@example.com");
        when(userService.getUser(any())).thenReturn(Optional.of(user));

        mockMvc.perform(get("/api/users/{id}", UUID.randomUUID()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Test"));
    }
}
```

## Conventions

- Test file: `{ClassName}Test.java` (unit) or `{ClassName}IntegrationTest.java`
- Test method: `{method}_{scenario}_{expectedResult}` (camelCase)
- Use `@Tag("unit")` or `@Tag("integration")` for filtering
- Run specific tags: `./gradlew test --tests -Dgroups=unit`

## Validation Gates (for Plan Hardening)

```markdown
- [ ] `./gradlew build` passes with zero errors (or `mvn clean install`)
- [ ] `./gradlew test` — all pass
- [ ] Integration tests with Testcontainers — all pass
- [ ] Anti-pattern grep: `grep -rn "DriverManager\|\.getConnection(" --include="*.java" src/` returns zero hits

## See Also

- `api-patterns.instructions.md` — Integration test patterns, route testing
- `database.instructions.md` — Repository testing, test databases
- `errorhandling.instructions.md` — Exception testing patterns
```

---

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "This method is too simple to test" | Simple methods get modified later. The test documents the contract and catches regressions when someone changes the "simple" logic. |
| "I'll add tests after the feature works" | Technical debt compounds exponentially. Red-Green-Refactor means the test exists before the implementation. |
| "The integration test covers this unit" | Integration tests are slow, don't pinpoint failures, and can't run in CI quickly. Unit tests are the foundation of the test pyramid. |
| "This is just a DTO/record — no logic to test" | Validation annotations, default values, and builder logic are testable. Test that `@NotNull` fields reject null, that defaults are correct. |
| "Mocking this dependency is too complex" | If it's hard to mock, the design has too much coupling. Fix the design with interfaces and DI — don't skip the test. |
| "One test for the happy path is enough" | Edge cases cause production incidents. Test null inputs, empty collections, boundary values, and concurrent access. |

---

## Warning Signs

- A test class has fewer `@Test` methods than the class under test has public methods (coverage gap)
- Test names describe implementation (`testCallsRepository`) instead of behavior (`getUser_withInvalidId_throwsNotFoundException`)
- Tests use `Thread.sleep` or hardcoded delays instead of Awaitility or CompletableFuture assertions
- No `@Tag` annotations — unable to filter unit vs integration tests in CI
- Arrange section is longer than 15 lines (test is testing too much or setup needs extraction via `@BeforeEach`)
- Tests directly `new` up concrete dependencies instead of using `@Mock` / `@InjectMocks`

---
description: Java authentication & authorization — Spring Security, JWT/OIDC, method security, multi-tenant, API keys, testing
applyTo: '**/*.java'
---

# Java Authentication & Authorization

## Security Filter Chain Order

```java
// ⚠️ ORDER MATTERS — Spring Security filters execute in defined order
@Configuration
@EnableWebSecurity
@EnableMethodSecurity  // Enables @PreAuthorize, @Secured
public class SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .cors(cors -> cors.configurationSource(corsConfigSource()))
            .csrf(csrf -> csrf.disable())  // Disable for stateless API
            .sessionManagement(session ->
                session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .oauth2ResourceServer(oauth2 ->
                oauth2.jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthConverter())))
            .addFilterBefore(tenantFilter, BearerTokenAuthenticationFilter.class)
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/health", "/api/docs/**").permitAll()
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated()
            );

        return http.build();
    }
}
```

## JWT / OIDC Configuration

### application.yml
```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: ${AUTH_ISSUER}
          audiences: ${AUTH_AUDIENCE}
          # Spring auto-fetches JWKS from issuer-uri/.well-known/jwks.json
```

### Custom JWT Authentication Converter
```java
@Component
public class JwtAuthConverter implements Converter<Jwt, AbstractAuthenticationToken> {

    @Override
    public AbstractAuthenticationToken convert(Jwt jwt) {
        Collection<GrantedAuthority> authorities = extractAuthorities(jwt);
        return new JwtAuthenticationToken(jwt, authorities, jwt.getSubject());
    }

    private Collection<GrantedAuthority> extractAuthorities(Jwt jwt) {
        List<GrantedAuthority> authorities = new ArrayList<>();

        // Map roles claim → ROLE_ prefix
        List<String> roles = jwt.getClaimAsStringList("roles");
        if (roles != null) {
            roles.forEach(role ->
                authorities.add(new SimpleGrantedAuthority("ROLE_" + role.toUpperCase())));
        }

        // Map scope claim → SCOPE_ prefix
        String scope = jwt.getClaimAsString("scope");
        if (scope != null) {
            Arrays.stream(scope.split(" "))
                .map(s -> new SimpleGrantedAuthority("SCOPE_" + s))
                .forEach(authorities::add);
        }

        return authorities;
    }
}
```

## Authorization

### Method Security with @PreAuthorize
```java
@Service
public class ProductService {

    @PreAuthorize("hasRole('ADMIN')")
    public void deleteProduct(UUID productId) {
        productRepository.deleteById(productId);
    }

    @PreAuthorize("hasAuthority('SCOPE_products:read')")
    public List<Product> listProducts() {
        return productRepository.findAllByTenantId(currentUser().getTenantId());
    }

    @PreAuthorize("hasRole('ADMIN') or @productSecurity.isOwner(#productId, authentication)")
    public ProductResponse getProduct(UUID productId) {
        return productRepository.findById(productId)
            .map(ProductMapper::toResponse)
            .orElseThrow(() -> new ResourceNotFoundException("Product not found"));
    }
}
```

### Custom Security Expressions
```java
@Component("productSecurity")
public class ProductSecurityEvaluator {

    private final ProductRepository productRepository;

    public ProductSecurityEvaluator(ProductRepository productRepository) {
        this.productRepository = productRepository;
    }

    public boolean isOwner(UUID productId, Authentication authentication) {
        return productRepository.findById(productId)
            .map(product -> product.getOwnerId().equals(authentication.getName()))
            .orElse(false);
    }
}
```

### URL-Based Authorization
```java
.authorizeHttpRequests(auth -> auth
    .requestMatchers(HttpMethod.GET, "/api/products/**").hasAuthority("SCOPE_products:read")
    .requestMatchers(HttpMethod.POST, "/api/products").hasAuthority("SCOPE_products:write")
    .requestMatchers(HttpMethod.DELETE, "/api/products/**").hasRole("ADMIN")
    .anyRequest().authenticated()
)
```

## Multi-Tenant Isolation

### Tenant Filter
```java
@Component
public class TenantFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {

        Authentication auth = SecurityContextHolder.getContext().getAuthentication();

        if (auth instanceof JwtAuthenticationToken jwtAuth) {
            String tenantId = jwtAuth.getToken().getClaimAsString("tenant_id");
            if (tenantId == null) {
                tenantId = request.getHeader("X-Tenant-ID");
            }

            if (tenantId == null) {
                response.sendError(HttpServletResponse.SC_FORBIDDEN, "Missing tenant context");
                return;
            }

            TenantContext.setCurrentTenant(tenantId);
        }

        try {
            filterChain.doFilter(request, response);
        } finally {
            TenantContext.clear(); // Prevent tenant leakage between requests
        }
    }
}
```

### Thread-Local Tenant Context
```java
public class TenantContext {

    private static final ThreadLocal<String> CURRENT_TENANT = new ThreadLocal<>();

    public static void setCurrentTenant(String tenantId) {
        CURRENT_TENANT.set(tenantId);
    }

    public static String getCurrentTenant() {
        String tenantId = CURRENT_TENANT.get();
        if (tenantId == null) {
            throw new IllegalStateException("No tenant context available");
        }
        return tenantId;
    }

    public static void clear() {
        CURRENT_TENANT.remove();
    }
}
```

### Tenant-Scoped Repository
```java
@Repository
public interface ProductRepository extends JpaRepository<Product, UUID> {

    // ✅ ALWAYS scope queries to tenant
    List<Product> findAllByTenantId(String tenantId);

    Optional<Product> findByIdAndTenantId(UUID id, String tenantId);

    // ❌ NEVER: Unscoped queries for tenant data
    // List<Product> findAll();
}
```

## API Key Authentication (Machine-to-Machine)

### API Key Filter
```java
@Component
public class ApiKeyAuthFilter extends OncePerRequestFilter {

    private final ApiKeyService apiKeyService;

    public ApiKeyAuthFilter(ApiKeyService apiKeyService) {
        this.apiKeyService = apiKeyService;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {

        String apiKey = request.getHeader("X-API-Key");
        if (apiKey != null) {
            Optional<ApiClient> client = apiKeyService.validateKey(apiKey);
            if (client.isEmpty()) {
                response.sendError(HttpServletResponse.SC_UNAUTHORIZED, "Invalid API key");
                return;
            }

            ApiClient c = client.get();
            List<GrantedAuthority> authorities = c.getRoles().stream()
                .map(role -> new SimpleGrantedAuthority("ROLE_" + role))
                .collect(Collectors.toList());

            UsernamePasswordAuthenticationToken auth =
                new UsernamePasswordAuthenticationToken(c.getClientId(), null, authorities);
            SecurityContextHolder.getContext().setAuthentication(auth);
            TenantContext.setCurrentTenant(c.getTenantId());
        }

        filterChain.doFilter(request, response);
    }
}
```

### Constant-Time Key Comparison
```java
import java.security.MessageDigest;

public boolean secureCompare(String a, String b) {
    byte[] aBytes = a.getBytes(StandardCharsets.UTF_8);
    byte[] bBytes = b.getBytes(StandardCharsets.UTF_8);
    return MessageDigest.isEqual(aBytes, bBytes);
}
```

### Register Both Auth Mechanisms
```java
http
    .addFilterBefore(apiKeyAuthFilter, BearerTokenAuthenticationFilter.class)
    .oauth2ResourceServer(oauth2 ->
        oauth2.jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthConverter())));
```

## Current User Helper

```java
public interface CurrentUser {
    String getId();
    String getEmail();
    String getTenantId();
    List<String> getRoles();
    boolean hasRole(String role);
    boolean hasScope(String scope);
}

@Component
@RequestScope
public class SpringCurrentUser implements CurrentUser {

    private final String id;
    private final String email;
    private final String tenantId;
    private final List<String> roles;
    private final List<String> scopes;

    public SpringCurrentUser() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth instanceof JwtAuthenticationToken jwtAuth) {
            Jwt jwt = jwtAuth.getToken();
            this.id = jwt.getSubject();
            this.email = jwt.getClaimAsString("email");
            this.tenantId = TenantContext.getCurrentTenant();
            this.roles = jwt.getClaimAsStringList("roles") != null
                ? jwt.getClaimAsStringList("roles") : List.of();
            String scope = jwt.getClaimAsString("scope");
            this.scopes = scope != null ? Arrays.asList(scope.split(" ")) : List.of();
        } else {
            this.id = auth != null ? auth.getName() : "anonymous";
            this.email = null;
            this.tenantId = TenantContext.getCurrentTenant();
            this.roles = List.of();
            this.scopes = List.of();
        }
    }

    @Override public boolean hasRole(String role) { return roles.contains(role); }
    @Override public boolean hasScope(String scope) { return scopes.contains(scope); }
    // ... other getters
}
```

## Testing Auth

### @WithMockUser for Simple Tests
```java
@WebMvcTest(ProductController.class)
class ProductControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    @WithMockUser(roles = "ADMIN")
    void deleteProduct_asAdmin_returns204() throws Exception {
        mockMvc.perform(delete("/api/products/{id}", productId))
            .andExpect(status().isNoContent());
    }

    @Test
    void deleteProduct_unauthenticated_returns401() throws Exception {
        mockMvc.perform(delete("/api/products/{id}", productId))
            .andExpect(status().isUnauthorized());
    }

    @Test
    @WithMockUser(roles = "USER")
    void deleteProduct_asUser_returns403() throws Exception {
        mockMvc.perform(delete("/api/products/{id}", productId))
            .andExpect(status().isForbidden());
    }
}
```

### Custom Mock JWT for Integration Tests
```java
@SpringBootTest
@AutoConfigureMockMvc
class ProductIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void listProducts_withValidJwt_returnsProducts() throws Exception {
        mockMvc.perform(get("/api/products")
            .with(jwt()
                .jwt(builder -> builder
                    .subject("test-user")
                    .claim("tenant_id", "test-tenant")
                    .claim("roles", List.of("user"))
                    .claim("scope", "products:read products:write"))
                .authorities(new SimpleGrantedAuthority("SCOPE_products:read"))))
            .andExpect(status().isOk());
    }

    @Test
    void listProducts_wrongTenant_returnsEmpty() throws Exception {
        mockMvc.perform(get("/api/products")
            .with(jwt()
                .jwt(builder -> builder
                    .subject("test-user")
                    .claim("tenant_id", "other-tenant"))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$").isEmpty());
    }
}
```

## Rules

- ALWAYS use `issuer-uri` for JWKS auto-discovery — never hardcode signing keys
- ALWAYS specify `algorithms` explicitly — never allow `none` or weak algorithms
- ALWAYS clear `TenantContext` in a `finally` block — prevent tenant leakage
- NEVER trust client headers for tenant ID without JWT claim validation
- NEVER use `findAll()` for tenant-scoped entities — always filter by `tenantId`
- Use `@PreAuthorize` for method-level security — configure `@EnableMethodSecurity`
- Use `MessageDigest.isEqual` for API key comparison — never `.equals()`
- Use `@WithMockUser` or `jwt()` in tests — never disable Spring Security for testing
- Use `@RequestScope` for current user beans — never store auth state in singletons
- Test all auth boundary cases: missing token, expired token, wrong role, wrong tenant

## See Also

- `security.instructions.md` — Input validation, secrets management, CORS, rate limiting
- `api-patterns.instructions.md` — Controller-level auth annotations
- `testing.instructions.md` — Spring test slice configurations

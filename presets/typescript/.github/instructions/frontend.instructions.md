---
description: TypeScript frontend patterns — React, component architecture, state management
applyTo: '**/*.tsx,**/*.jsx,**/components/**'
---

# TypeScript Frontend Patterns

## Component Architecture

### File Organization
```
src/
├── components/        # Reusable UI components
│   ├── Button/
│   │   ├── Button.tsx
│   │   ├── Button.test.tsx
│   │   └── Button.module.css
│   └── ...
├── pages/             # Route-level components
├── hooks/             # Custom React hooks
├── services/          # API client, auth, state
├── types/             # Shared TypeScript types
└── utils/             # Pure utility functions
```

### Component Patterns

```tsx
// ✅ Typed props with interface
interface UserCardProps {
  user: User;
  onEdit: (id: string) => void;
  isLoading?: boolean;
}

export function UserCard({ user, onEdit, isLoading = false }: UserCardProps) {
  if (isLoading) return <Skeleton />;
  
  return (
    <div className="user-card">
      <h3>{user.name}</h3>
      <button onClick={() => onEdit(user.id)}>Edit</button>
    </div>
  );
}
```

## State Management

### Server State (TanStack Query)
```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => api.getUsers(),
  });
}

function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateUserInput) => api.createUser(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}
```

## Non-Negotiable Rules

### Type Safety
```tsx
// ❌ NEVER: `any` in props or state
const [data, setData] = useState<any>(null);

// ✅ ALWAYS: Explicit types
const [data, setData] = useState<User | null>(null);
```

### Error Boundaries
```tsx
// ✅ Wrap route-level components
<ErrorBoundary fallback={<ErrorPage />}>
  <UserDashboard />
</ErrorBoundary>
```

### Accessibility
```tsx
// ✅ Always include aria attributes for interactive elements
<button aria-label="Delete user" onClick={handleDelete}>
  <TrashIcon />
</button>
```

## CSS & Styling

### CSS Modules (Recommended)
```tsx
// ✅ Scoped styles — no class name collisions
import styles from './UserCard.module.css';

export function UserCard({ user }: UserCardProps) {
  return <div className={styles.card}>{user.name}</div>;
}
```

```css
/* UserCard.module.css */
.card {
  padding: 1rem;
  border-radius: 8px;
  background: var(--surface-color);
}
```

### Theming with CSS Custom Properties
```css
/* globals.css — define tokens, not raw values */
:root {
  --color-primary: #0066cc;
  --color-surface: #ffffff;
  --spacing-sm: 0.5rem;
  --spacing-md: 1rem;
  --radius-md: 8px;
}

/* Dark mode */
[data-theme="dark"] {
  --color-primary: #4da6ff;
  --color-surface: #1a1a1a;
}
```

### Responsive Patterns
```css
/* ✅ Mobile-first: base styles, then layer up */
.container {
  padding: var(--spacing-sm);
}

@media (min-width: 768px) {
  .container { padding: var(--spacing-md); }
}
```

### Naming & Organization
- **One CSS Module per component** — co-locate `Button.module.css` with `Button.tsx`
- **Use camelCase** for multi-word class names: `.userCard` (CSS Modules auto-convert)
- **Never use inline styles** for anything other than dynamic values (e.g., `style={{ width }}`)
- **Avoid `!important`** — fix specificity instead

## Version Display

### Build-time Version Injection
```typescript
// vite.config.ts — inject version from package.json
import { defineConfig } from 'vite';
import pkg from './package.json';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    __GIT_COMMIT__: JSON.stringify(process.env.GIT_COMMIT_SHA ?? 'dev'),
  },
});

// global.d.ts — type declarations
declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;
declare const __GIT_COMMIT__: string;
```

### Version Display Component
```tsx
interface AppVersionProps {
  showCommit?: boolean;
}

export function AppVersion({ showCommit = false }: AppVersionProps) {
  return (
    <span className="app-version" data-testid="app-version">
      v{__APP_VERSION__}
      {showCommit && (
        <span className="commit-hash"> ({__GIT_COMMIT__.slice(0, 7)})</span>
      )}
    </span>
  );
}

// Usage in footer
export function Footer() {
  return (
    <footer>
      <AppVersion showCommit={import.meta.env.DEV} />
    </footer>
  );
}
```

### Environment Badge
```tsx
export function EnvironmentBadge() {
  const env = import.meta.env.MODE;  // 'development' | 'staging' | 'production'
  if (env === 'production') return null;

  const colors: Record<string, string> = {
    development: '#f59e0b',
    staging: '#3b82f6',
  };

  return (
    <div
      style={{ backgroundColor: colors[env] ?? '#6b7280' }}
      className="env-badge"
      role="status"
      aria-label={`Environment: ${env}`}
    >
      {env.toUpperCase()} — v{__APP_VERSION__}
    </div>
  );
}
```

### Non-Negotiable Rules
- **NEVER** hardcode version strings in components — inject at build time
- **ALWAYS** show environment badge in non-production environments
- Hide commit hash in production builds (use `import.meta.env.DEV` guard)
- Version info must match backend `/api/version` endpoint schema

## See Also

- `version.instructions.md` — Semantic versioning, changelog, pre-release patterns
- `api-patterns.instructions.md` — API client patterns, route structure, API versioning
- `testing.instructions.md` — Component testing, mocking strategies
- `security.instructions.md` — Input validation, XSS prevention
- `performance.instructions.md` — Bundle optimization, lazy loading

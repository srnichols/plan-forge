# Instructions for Copilot — TypeScript Project

> **Stack**: TypeScript 7 / React 19.3 / Node.js 24 LTS / Express 5
> **Last Updated**: <DATE>

---

## Architecture Principles

**BEFORE any code changes, read:** `.github/instructions/architecture-principles.instructions.md`

### Core Rules
1. **Architecture-First** — Ask 5 questions before coding
2. **Separation of Concerns** — Route → Service → Repository
3. **Best Practices Over Speed** — Enterprise-grade, not hacky
4. **TDD for Business Logic** — Red-Green-Refactor
5. **Type Safety** — No `any`, explicit types everywhere

### Red Flags
```
❌ "as any"              → STOP, add proper types
❌ "@ts-ignore"          → STOP, fix the type error
❌ "copy-paste"          → STOP, extract to utility
❌ "we'll refactor later" → STOP, do it right now
```

---

## Project Overview

**Description**: <!-- What your app does -->

**Tech Stack**:
- Frontend: React 19.3, TypeScript 7, Vite 8, TanStack Query
- Backend: Node.js 24 LTS, Express 5, TypeScript 7
- Database: PostgreSQL 18 with Prisma 7.10
- Testing: Vitest 5, Jest 30, Supertest, Playwright 1.63
- Linting: ESLint 10 flat config (`eslint.config.js`)
- Package Manager: pnpm (monorepo)

---

## Coding Standards

### TypeScript Style
- **Strict mode**: Enabled — no implicit any
- **Named exports**: Prefer over default exports
- **Interfaces**: For object shapes; types for unions/intersections
- **Zod**: For runtime validation of external data
- **Functional**: Prefer pure functions, minimize class usage

### API Layer (Express)
```typescript
// Route → validate input → call service → return response
router.post('/users', async (req, res) => {
  const input = CreateUserSchema.parse(req.body);      // Validate
  const user = await userService.createUser(input);     // Business logic
  res.status(201).json(user);                           // Response
});
```

### Database (Prisma)
```typescript
// Always use Prisma Client — never raw SQL unless performance requires it
const user = await prisma.user.findUnique({
  where: { id: userId },
  include: { profile: true },
});
```

### Testing
- **Vitest** for unit + integration
- **Supertest** for API endpoints
- **Playwright** for E2E user flows

---

## Quick Commands

```bash
pnpm install                    # Install dependencies
pnpm dev                        # Start dev servers
pnpm build                      # Build all packages
pnpm test                       # Run all tests
pnpm test -- --run              # Tests without watch
pnpm lint                       # Lint all packages
docker compose up -d            # Start infrastructure
```

---

## Planning & Execution

This project uses the **Plan Forge Pipeline**:
- **Runbook**: `docs/plans/AI-Plan-Hardening-Runbook.md`
- **Instructions**: `docs/plans/AI-Plan-Hardening-Runbook-Instructions.md`
- **Roadmap**: `docs/plans/DEPLOYMENT-ROADMAP.md`

### Instruction Files

| File | Domain |
|------|--------|
| `architecture-principles.instructions.md` | Core architecture rules |
| `database.instructions.md` | Prisma patterns |
| `frontend.instructions.md` | React component patterns |
| `testing.instructions.md` | Vitest, Supertest |
| `security.instructions.md` | Auth, Zod validation, secrets |
| `deploy.instructions.md` | Docker, pnpm monorepo |
| `git-workflow.instructions.md` | Commit conventions |

---

## Code Review Checklist

- [ ] No `any` types (use `unknown` + type guards if needed)
- [ ] No `@ts-ignore` or `@ts-expect-error`
- [ ] Zod validation on all external inputs
- [ ] Error handling with typed errors
- [ ] Async/await (no unhandled promises)
- [ ] Tests included for new features
- [ ] Named exports (no default exports)

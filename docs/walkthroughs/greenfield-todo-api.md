# Walkthrough: Build a Todo API from Scratch

> **Time**: ~45 minutes  
> **Stack**: TypeScript / Node.js / Express / Prisma  
> **What you'll build**: A full CRUD Todo API with authentication, validation, and tests  
> **What you'll learn**: The complete Plan Forge pipeline — from specification to shipped feature

---

## Prerequisites

- Node.js 18+ installed
- VS Code with GitHub Copilot (Agent Mode)
- An empty directory for your project

---

## 1. Initialize Your Project

### Create the project

```bash
mkdir todo-tracker && cd todo-tracker
npm init -y
npm install express prisma @prisma/client zod jsonwebtoken bcrypt
npm install -D typescript @types/express @types/node vitest supertest @types/supertest
npx tsc --init
npx prisma init
```

### Install Plan Forge

```powershell
# PowerShell (Windows)
.\setup.ps1 -Preset typescript -ProjectName "Todo Tracker" -Agent all

# Bash (macOS/Linux)
./setup.sh --preset typescript --name "Todo Tracker" --agent all
```

You'll see Plan Forge install ~60 files:
```
Step 1: Core template files
  CREATE .github/copilot-instructions.md
  CREATE .github/instructions/architecture-principles.instructions.md
  ...16 more instruction files...

Step 3: typescript preset files
  CREATE .github/agents/architecture-reviewer.agent.md
  ...6 agents, 15 prompts, 9 skills...

Step 3b: Shared agents + skills
  CREATE .github/skills/security-audit/SKILL.md
  CREATE .github/skills/health-check/SKILL.md
  CREATE .github/skills/forge-execute/SKILL.md

Step 6b: Agent adapters (claude, cursor, codex, gemini)
  CREATE CLAUDE.md
  CREATE .cursor/rules
  CREATE .agents/skills/...
  CREATE GEMINI.md
```

### Verify the setup

```bash
pforge smith
```

```
╔═══════════════════════════════════════════════════╗
║           ⚒️  PLAN FORGE — SMITH REPORT           ║
╚═══════════════════════════════════════════════════╝

Environment:
  ✅ git 2.44.0
  ✅ VS Code 1.100.0
  ✅ PowerShell 7.5
  ✅ Node.js 22.4.0

VS Code Config:
  ✅ Agent mode enabled
  ✅ Instructions auto-attach enabled

Setup Health:
  ✅ 17 instruction files
  ✅ 13 agent files
  ✅ 15 prompt files
  ✅ 12 skill files

  Summary: 24 passed, 0 failed, 0 warnings
```

**Everything green.** Your forge is ready.

---

## 2. Specify the Feature (Step 0)

Open Copilot Chat (`Ctrl+Shift+I`), select **Agent Mode**, and attach `.github/prompts/step0-specify-feature.prompt.md`.

Replace `<FEATURE-NAME>` with `todo-crud-api` and send.

The agent interviews you. Here's what to say:

> **Problem Statement**: "We need a REST API for managing todo items. Users should be able to create, read, update, and delete todos. Each todo belongs to a user and has a title, description, completion status, and due date."
>
> **User Scenarios**:
> - "A user creates a todo: POST /api/todos with title and optional description/due date"
> - "A user lists their todos: GET /api/todos (only their own, not others')"
> - "A user marks a todo complete: PATCH /api/todos/:id with { completed: true }"
> - "A user deletes a todo: DELETE /api/todos/:id (only if they own it)"
>
> **Acceptance Criteria**:
> - "All endpoints require JWT authentication"
> - "Input validated with Zod schemas"
> - "Parameterized queries via Prisma (no raw SQL)"
> - "404 for non-existent todos, 403 for todos owned by others"
> - "Unit tests for service layer, integration tests for API"
>
> **Edge Cases**:
> - "Empty title → 400 validation error"
> - "Due date in the past → allowed (user might be logging completed work)"
> - "Deleting an already-deleted todo → 404"
>
> **Out of Scope**: "No UI. No real-time updates. No file attachments. No sharing/collaboration."

The agent produces a specification block and creates `docs/plans/Phase-1-TODO-CRUD-PLAN.md`.

---

## 3. Harden the Plan (Step 2)

In the same session, attach `.github/prompts/step2-harden-plan.prompt.md`. Replace `<YOUR-PLAN>` with `Phase-1-TODO-CRUD-PLAN`.

The hardening agent structures your plan into an execution contract:

### The Scope Contract

```markdown
### In Scope
- src/routes/todos.ts — CRUD endpoints
- src/services/todoService.ts — business logic
- src/schemas/todo.ts — Zod validation schemas
- prisma/schema.prisma — Todo model
- tests/unit/todoService.test.ts
- tests/integration/todos.test.ts

### Out of Scope
- Authentication system (assume JWT middleware exists)
- Frontend
- Real-time features

### Forbidden Actions
- Do NOT modify auth middleware
- Do NOT add new npm dependencies without asking
- Do NOT create database tables outside the Todo model
```

### The Execution Slices

The agent creates 3 slices:

| Slice | What | Build Gate | Test Gate |
|-------|------|-----------|----------|
| 1 | Prisma model + migration | `npx prisma generate` | `npx prisma migrate status` |
| 2 | Service layer + unit tests | `npx tsc --noEmit` | `npx vitest run tests/unit/` |
| 3 | Routes + integration tests | `npx tsc --noEmit` | `npx vitest run` |

> **Notice**: Each slice has an exact build command and test command. The orchestrator will run these automatically. No ambiguity.

When the agent says **"Plan hardened ✅"** — you're ready to execute.

---

## 4. Execute the Plan (Step 3)

### Option A: Automatic Execution (Recommended)

```bash
pforge run-plan docs/plans/Phase-1-TODO-CRUD-PLAN.md
```

Watch the dashboard at `localhost:3100/dashboard`:
- Slice 1 executes via `gh copilot` → Prisma schema created → migration runs → ✅
- Slice 2 executes → service with create/findAll/findById/update/delete → tests pass → ✅
- Slice 3 executes → Express routes with auth middleware → integration tests pass → ✅

Total time: ~8 minutes. Total cost: ~$0.15 (with Claude Sonnet).

### Option B: Assisted Mode (Interactive)

```bash
pforge run-plan --assisted docs/plans/Phase-1-TODO-CRUD-PLAN.md
```

You code each slice in VS Code. The orchestrator validates between slices.

### What the AI Writes

**Slice 1** — The Prisma model:
```prisma
model Todo {
  id          String    @id @default(uuid())
  title       String
  description String?
  completed   Boolean   @default(false)
  dueDate     DateTime? @map("due_date")
  userId      String    @map("user_id")
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  @@index([userId])
  @@map("todos")
}
```

**Slice 2** — The service layer (notice: no HTTP concerns here, just business logic):
```typescript
// src/services/todoService.ts
export class TodoService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(userId: string, data: CreateTodoInput): Promise<Todo> {
    return this.prisma.todo.create({
      data: { ...data, userId },
    });
  }

  async findAllForUser(userId: string): Promise<Todo[]> {
    return this.prisma.todo.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByIdForUser(id: string, userId: string): Promise<Todo | null> {
    return this.prisma.todo.findFirst({
      where: { id, userId }, // ownership check built in
    });
  }
}
```

> **Notice the guardrail in action**: The `database.instructions.md` file auto-loaded when the AI edited `todoService.ts`, so it used Prisma's parameterized queries rather than raw SQL. The `architecture-principles.instructions.md` kept business logic in the service layer, not in the route handlers.

**Slice 3** — The routes (notice: HTTP handling only, delegates to service):
```typescript
// src/routes/todos.ts
router.post('/', requireAuth, async (req, res) => {
  const parsed = createTodoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ errors: parsed.error.flatten() });
  }
  const todo = await todoService.create(req.userId!, parsed.data);
  res.status(201).json(todo);
});
```

### When a Gate Fails

During Slice 3, the build gate fails:
```
npx tsc --noEmit
src/routes/todos.ts(12,5): error TS2345: Argument of type 'string | undefined'
  is not assignable to parameter of type 'string'.
```

The orchestrator detects the failure, feeds the error back to the AI, and it fixes the type:
```typescript
const todo = await todoService.create(req.userId!, parsed.data);
//                                              ^ Added non-null assertion
//                                                (auth middleware guarantees userId)
```

Build gate re-runs → ✅. This is the validation loop in action.

---

## 5. Review (Step 5)

Start a **new session** and attach `.github/prompts/step5-review-gate.prompt.md`.

The reviewer agent inspects all changes against the scope contract:

```
Review Gate Results:
  ✅ Scope compliance: All files within scope contract
  ✅ Architecture: Service layer → no HTTP concerns in services
  ✅ Security: Parameterized queries via Prisma, ownership checks on all endpoints
  ✅ Tests: Unit tests for service, integration tests for routes
  ⚠️  WARNING: No rate limiting on POST /api/todos (medium risk)
  ✅ No TODO/FIXME markers in production code

  Result: PASS (1 warning)
  Recommendation: Add rate limiting in a follow-up phase
```

> **The value of independent review**: The Review Gate runs in a fresh session with zero context from the execution session. It can't be biased by "I wrote this code, so it must be fine."

---

## 6. Ship (Step 6)

```bash
git add -A
git commit -m "feat(todos): add CRUD API with auth, validation, tests"
git push origin main
```

Run the final analysis:
```bash
pforge analyze docs/plans/Phase-1-TODO-CRUD-PLAN.md
```

```
Consistency Score: 95/100
  - Traceability:   25/25 (all requirements → code)
  - Coverage:       25/25 (all files in scope)
  - Test Coverage:  22/25 (1 edge case untested: past due date)
  - Gates:          23/25 (1 deferred recommendation: rate limiting)
```

---

## What You Learned

| Concept | How You Experienced It |
|---------|----------------------|
| **Guardrails auto-load** | `database.instructions.md` loaded when editing the Prisma model |
| **Scope contracts prevent drift** | The AI couldn't add a "tags" feature because it wasn't in scope |
| **Validation gates catch errors** | TypeScript build failure was caught and auto-fixed |
| **Independent review works** | Fresh session found a rate-limiting gap the builder missed |
| **Consistency scoring is measurable** | 95/100 — you can track this across phases |

---

## Next Steps

- **Try the brownfield walkthrough** — add Plan Forge to an existing codebase
- **Build a real feature** — pick something from your actual project backlog
- **Set up CI** — add `srnichols/plan-forge-validate@v1` to your GitHub Actions
- **Try quorum mode** — `pforge run-plan --quorum docs/plans/Phase-2-PLAN.md` for 3-model consensus

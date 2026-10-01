---
description: "Scaffold Vitest 5/Jest 30 test files with proper describe/it blocks, mock setup, and naming conventions."
agent: "agent"
tools: [read, edit, search, execute]
---
# Create New Test

Scaffold test files following project conventions.

## Test Naming Convention

```
describe('{ClassName}')
  describe('{methodName}')
    it('should {expected} when {condition}')
```

## Unit Test Pattern (Vitest 5/Jest 30)

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { {EntityName}Service } from '../services/{entityName}Service';
import { {EntityName}Repository } from '../repositories/{entityName}Repository';

describe('{EntityName}Service', () => {
  let service: {EntityName}Service;
  let mockRepo: { findById: ReturnType<typeof vi.fn>; insert: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockRepo = {
      findById: vi.fn(),
      insert: vi.fn(),
    };
    service = new {EntityName}Service(mockRepo as any, mockLogger);
  });

  describe('getById', () => {
    it('should return entity when found', async () => {
      const entity = { id: '123', name: 'Test' };
      mockRepo.findById.mockResolvedValue(entity);

      const result = await service.getById('123');

      expect(result).toEqual(entity);
      expect(mockRepo.findById).toHaveBeenCalledWith('123');
    });

    it('should throw NotFoundError when not found', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(service.getById('999')).rejects.toThrow(NotFoundError);
    });
  });

  describe('create', () => {
    it('should validate input and create entity', async () => {
      const input = { name: 'New Item' };
      const created = { id: '456', ...input };
      mockRepo.insert.mockResolvedValue(created);

      const result = await service.create(input);

      expect(result).toEqual(created);
    });

    it('should throw on invalid input', async () => {
      await expect(service.create({ name: '' })).rejects.toThrow();
    });
  });
});
```

## Integration Test Pattern

```typescript
import { Pool } from 'pg';
import { GenericContainer, StartedTestContainer } from 'testcontainers';

describe('{EntityName}Repository (integration)', () => {
  let container: StartedTestContainer;
  let pool: Pool;

  beforeAll(async () => {
    container = await new GenericContainer('postgres:18-alpine')
      .withExposedPorts(5432)
      .withEnvironment({ POSTGRES_DB: 'test', POSTGRES_PASSWORD: 'test' })
      .start();
    pool = new Pool({ connectionString: `postgresql://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/test` });
    // Run migrations
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });
});
```

## Reference Files

- [Testing instructions](../instructions/testing.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)

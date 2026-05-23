/**
 * Plan Forge SDK — Notification Adapter Contract (public re-export)
 *
 * This file is the PUBLIC import surface for the notification adapter contract.
 * Importers MUST use this path:
 *   - via relative path: ../pforge-sdk/notifications/adapter-contract.mjs
 *   - via npm subpath:   import ... from "pforge-sdk/notifications/adapter-contract"
 *
 * Do NOT import from "pforge-sdk/src/notifications/adapter-contract.mjs" —
 * that path reaches into SDK internals and breaks the Component Cohesion
 * (CRP) rule in architecture-principles.instructions.md. The /src/ layout
 * is an implementation detail that may change without notice.
 *
 * Internal location: ../src/notifications/adapter-contract.mjs
 */
export * from '../src/notifications/adapter-contract.mjs';

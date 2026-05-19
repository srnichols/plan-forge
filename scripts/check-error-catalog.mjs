#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const generator = resolve(HERE, "generate-error-catalog.mjs");

const result = spawnSync(process.execPath, [generator, "--check"], {
  stdio: "inherit",
  encoding: "utf-8",
});

process.exit(result.status ?? 1);

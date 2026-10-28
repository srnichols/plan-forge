/**
 * A stub `npm` for tests that run a script which installs dependencies but must not take minutes or need the network.
 * It logs the directory it ran in and its arguments to $STUB_NPM_LOG, then exits 0. PowerShell on Windows finds
 * `npm.cmd` and Bash finds the extensionless script, so each flavor has a directory of its own: PowerShell would
 * otherwise pick the extensionless file.
 */

import { chmodSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";

const isWin = process.platform === "win32";

/** Real npm with no network: a package with no dependencies has nothing to fetch. */
export const REAL_NPM_ENV = Object.freeze({ npm_config_offline: "true", npm_config_audit: "false", npm_config_fund: "false", npm_config_update_notifier: "false" });

/** Writes the stub into the existing directory `dir`. `flavor` is "ps" for PowerShell and anything else for Bash. */
export function writeStubNpm(dir, flavor) {
  if (isWin && flavor === "ps") {
    writeFileSync(join(dir, "npm.cmd"), ["@echo off", 'echo "%CD%" "%*" >> "%STUB_NPM_LOG%"', "exit /b 0", ""].join("\r\n"));
    return dir;
  }
  writeFileSync(join(dir, "npm"), ["#!/usr/bin/env bash", 'echo "$PWD $*" >> "$STUB_NPM_LOG"', "exit 0", ""].join("\n"));
  if (!isWin) chmodSync(join(dir, "npm"), 0o755);
  return dir;
}

/** The environment with `stub` first on PATH. On Windows the variable is `Path`, and a second `PATH` key would be ignored. */
export function envWithStub(stub, extra) {
  const env = { ...process.env, ...extra };
  const key = Object.keys(env).find((name) => name.toLowerCase() === "path") ?? "PATH";
  env[key] = `${stub}${delimiter}${env[key] ?? ""}`;
  return env;
}

/** The framework packages the stub saw `npm install` in, in order. */
export function installsIn(logText) {
  return logText
    .replace(/\\/g, "/")
    .split(/\r?\n/)
    .map((line) => /\/(pforge-mcp|pforge-master)"? "?install\b/.exec(line)?.[1])
    .filter(Boolean);
}

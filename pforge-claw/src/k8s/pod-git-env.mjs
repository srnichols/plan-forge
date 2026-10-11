import path from "node:path";
import { ClawError } from "../errors.mjs";

const DEFAULT_AUTHOR_NAME = "Forge-Claw";
const DEFAULT_AUTHOR_EMAIL = "claw@localhost";
const CREDENTIAL_HELPER = "!gh auth git-credential";
const IDENTITY_MAX_LENGTH = 256;
const IDENTITY_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f<>]/;

function gitToken({ env, secrets }) {
  return secrets?.get?.("PFORGE_CLAW_GH_TOKEN") || env.PFORGE_CLAW_GH_TOKEN || env.GH_TOKEN;
}

function identity(value, fallback) {
  if (value === undefined || value === "") return fallback;
  if (typeof value !== "string" || !value.trim() || value.length > IDENTITY_MAX_LENGTH
    || IDENTITY_CONTROL_CHARACTERS.test(value)) {
    throw new ClawError("POD_GIT_IDENTITY_INVALID");
  }
  return value;
}

/**
 * Build process-only Git configuration for a one-shot workspace; never write host configuration.
 * @param {{env?: object, home: string, secrets?: {get?: Function}}} options
 * @returns {object}
 */
export function createPodGitEnvironment({ env = process.env, home, secrets } = {}) {
  const childEnv = { ...env };
  delete childEnv.GIT_CONFIG_PARAMETERS;
  delete childEnv.GIT_ASKPASS;
  delete childEnv.SSH_ASKPASS;
  for (const name of Object.keys(childEnv)) {
    if (/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(name) || name.startsWith("GIT_TRACE")) delete childEnv[name];
  }
  const token = gitToken({ env, secrets });
  if (token) childEnv.GH_TOKEN = token;
  childEnv.HOME = home;
  childEnv.XDG_CONFIG_HOME = path.join(home, ".config");
  childEnv.GH_CONFIG_DIR = path.join(home, ".config", "gh");
  childEnv.GH_PROMPT_DISABLED = "1";
  childEnv.GH_DEBUG = "";
  childEnv.GIT_TERMINAL_PROMPT = "0";
  childEnv.GIT_CONFIG_NOSYSTEM = "1";
  childEnv.GIT_CONFIG_GLOBAL = path.join(home, ".gitconfig");
  childEnv.GIT_CONFIG_COUNT = "2";
  childEnv.GIT_CONFIG_KEY_0 = "credential.helper";
  childEnv.GIT_CONFIG_VALUE_0 = "";
  childEnv.GIT_CONFIG_KEY_1 = "credential.helper";
  childEnv.GIT_CONFIG_VALUE_1 = CREDENTIAL_HELPER;
  childEnv.GIT_AUTHOR_NAME = identity(env.GIT_AUTHOR_NAME, DEFAULT_AUTHOR_NAME);
  childEnv.GIT_AUTHOR_EMAIL = identity(env.GIT_AUTHOR_EMAIL, DEFAULT_AUTHOR_EMAIL);
  childEnv.GIT_COMMITTER_NAME = identity(env.GIT_COMMITTER_NAME, childEnv.GIT_AUTHOR_NAME);
  childEnv.GIT_COMMITTER_EMAIL = identity(env.GIT_COMMITTER_EMAIL, childEnv.GIT_AUTHOR_EMAIL);
  for (const name of ["GIT_TRACE", "GIT_TRACE_CURL", "GIT_TRACE_PACKET", "GIT_CURL_VERBOSE"]) {
    childEnv[name] = "0";
  }
  childEnv.GIT_TRACE_REDACT = "1";
  childEnv.GIT_TRACE_CURL_NO_DATA = "1";
  return childEnv;
}

/**
 * @azure/identity is an optional dependency. orchestrator/worker-spawn.mjs loads it for the Microsoft Entra sign-in and
 * calls `new DefaultAzureCredential()`. Updating the locks for GHSA-xcx6-jx8p-x3h5 moved @azure/msal-node, which does
 * the sign-in, from 6 to 7, and nothing ran the pair after a lock update: the advisory issue said an override "has not
 * been tried against a real Azure sign-in".
 *
 * This loads the pair the way Plan Forge does and builds the credential, on each Node version CI runs. It asks for
 * no token, so it needs no account and no network. It is skipped only where the optional dependency is not installed:
 * a copy that is installed and cannot be loaded (a Node it does not support, an @azure/msal-node it cannot load) fails,
 * which is what this test is for.
 */

import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * Whether `name` is installed. `resolve` only looks the package up, so the answer is false for a package that is
 * missing and nothing else: any other error (a broken package.json, an `exports` map with no way in) is thrown.
 */
function isInstalled(name) {
  try {
    require.resolve(name);
    return true;
  } catch (error) {
    if (error?.code === "MODULE_NOT_FOUND" && String(error.message).startsWith(`Cannot find module '${name}'`)) return false;
    throw error;
  }
}

// Optional: an install that could not take it (or skipped optional dependencies) has no Entra sign-in to check.
const identity = isInstalled("@azure/identity") ? await import("@azure/identity") : null;

describe.skipIf(identity === null)("the optional @azure/identity", () => {
  it("exports the credential Plan Forge builds for the Entra sign-in", () => {
    expect(typeof identity.DefaultAzureCredential).toBe("function");
  });

  it("builds a DefaultAzureCredential without an account or a network", () => {
    const credential = new identity.DefaultAzureCredential();
    expect(typeof credential.getToken).toBe("function");
  });

  it("takes the @azure/msal-node it asks for, and that loads here", () => {
    // Resolved from @azure/identity's own location, so this is the copy it would use.
    const fromIdentity = createRequire(require.resolve("@azure/identity"));
    const msal = fromIdentity("@azure/msal-node");
    expect(typeof msal.ConfidentialClientApplication).toBe("function");
    expect(typeof msal.PublicClientApplication).toBe("function");
  });
});

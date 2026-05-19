/**
 * Plan Forge — Phase-53 (ORCHESTRATOR-SPLIT) Slice 1
 * Mutable module-level orchestrator state.
 */

let cachedBashPath = undefined;
let ghCopilotProbeState = null;
let ghCopilotCacheState = null;
let secretsLoaderState = null;
let cliWorkersCacheState = null;
let cliWorkersCacheExpiryState = 0;
let workerCapabilitiesCacheState = null;
let postSliceHookFiredState = false;
let postSliceTemperingFiredState = new Set();

export function getCachedBashPath() { return cachedBashPath; }
export function setCachedBashPath(value) { cachedBashPath = value; }

export function getGhCopilotProbeState() { return ghCopilotProbeState; }
export function setGhCopilotProbeState(value) { ghCopilotProbeState = value; }

export function getGhCopilotCacheState() { return ghCopilotCacheState; }
export function setGhCopilotCacheState(value) { ghCopilotCacheState = value; }

export function getSecretsLoaderState() { return secretsLoaderState; }
export function setSecretsLoaderState(value) { secretsLoaderState = value; }

export function getCliWorkersCacheState() { return cliWorkersCacheState; }
export function setCliWorkersCacheState(value) { cliWorkersCacheState = value; }

export function getCliWorkersCacheExpiryState() { return cliWorkersCacheExpiryState; }
export function setCliWorkersCacheExpiryState(value) { cliWorkersCacheExpiryState = value; }

export function getWorkerCapabilitiesCacheState() { return workerCapabilitiesCacheState; }
export function setWorkerCapabilitiesCacheState(value) { workerCapabilitiesCacheState = value; }

export function getPostSliceHookFiredState() { return postSliceHookFiredState; }
export function setPostSliceHookFiredState(value) { postSliceHookFiredState = value; }

export function getPostSliceTemperingFiredState() { return postSliceTemperingFiredState; }
export function setPostSliceTemperingFiredState(value) { postSliceTemperingFiredState = value; }

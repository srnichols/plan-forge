/**
 * Back-compatible module path for the Forge-Master githubCopilot provider.
 *
 * The implementation now uses the GitHub Copilot SDK rather than the retired
 * GitHub Models HTTP endpoint.
 */

export * from "./copilot-sdk-tools.mjs";

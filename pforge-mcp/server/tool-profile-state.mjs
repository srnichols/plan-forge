/** The MCP server process's active tool profiles (see tool-profiles.mjs). */

import { PROJECT_DIR } from "./state.mjs";
import { createToolProfileState, resolveInitialProfiles } from "./tool-profiles.mjs";

export const toolProfiles = createToolProfileState(resolveInitialProfiles({ cwd: PROJECT_DIR }));

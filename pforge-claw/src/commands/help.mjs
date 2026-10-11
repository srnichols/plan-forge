import { renderCommandHelp, renderHelp, splitHelp } from "../handlers/help.mjs";
import { ROLES } from "../enums.mjs";

export default Object.freeze({
  name: "help",
  aliases: ["start"],
  args: "[command]",
  summary: "Show commands available in this topic",
  details: "List commands available to your role, or show syntax and examples for one command.",
  examples: ["/help", "/help status", "/start"],
  roles: [...ROLES],
  scope: "both",
  mutating: false,
  available: true,
  sinceSlice: 5,
  group: "Admin",
  async handle(ctx, input = {}) {
    const topic = input.argsText?.trim();
    const command = input.helpCommand ?? null;
    const text = command
      ? renderCommandHelp(command, { role: input.caller.role, scope: ctx.scope, commands: input.commands })
      : renderHelp({ role: input.caller.role, scope: ctx.scope, project: ctx.project, commands: input.commands });
    return splitHelp(text).map((part) => ({ text: part }));
  },
});

export function makeStub({ name, summary, usage, owningSlice }) {
  return {
    name,
    summary,
    usage,
    owningSlice,
    async run(_argv) {
      process.stderr.write(`pforge claw ${name}: not yet implemented (Slice ${owningSlice})\n`);
      return 2;
    },
  };
}

const OID_LENGTH = 40;
const INITIAL_OID = "a".repeat(OID_LENGTH);
const EXECUTED_OID = "b".repeat(OID_LENGTH);
const VERIFY_ARGUMENTS = 3;
const ANCESTRY_ARGUMENTS = 4;
const UPDATE_ARGUMENTS = 4;
const denied = () => ({ code: 1, stdout: "", stderr: "FIXTURE_GIT_REF_DENIED" });
const accepted = (stdout = "") => ({ code: 0, stdout, stderr: "" });

/** Model only verified fixture OIDs and the approved ref's ancestry/CAS, never native process proof. */
export function createPublicationGitFixture({ jobId, hasChanges = true }) {
  const ref = typeof jobId === "string" && jobId ? `refs/heads/claw/${jobId}` : null;
  const head = hasChanges ? EXECUTED_OID : INITIAL_OID;
  let current = INITIAL_OID;
  const handlers = {
    "rev-parse": (args) => {
      if (args.length !== VERIFY_ARGUMENTS || args[1] !== "--verify") return denied();
      if (args[2] === "HEAD") return accepted(`${head}\n`);
      return args[2] === ref ? accepted(`${current}\n`) : denied();
    },
    "merge-base": (args) => {
      return args.length === ANCESTRY_ARGUMENTS && args[1] === "--is-ancestor"
        && [INITIAL_OID, head].includes(args[2]) && args[3] === head ? accepted() : denied();
    },
    "update-ref": (args) => {
      if (args.length !== UPDATE_ARGUMENTS || args[1] !== ref || args[2] !== head || args[3] !== current) return denied();
      current = head;
      return accepted();
    },
  };
  return (args) => {
    if (!Object.hasOwn(handlers, args[0])) return null;
    return ref ? handlers[args[0]](args) : denied();
  };
}

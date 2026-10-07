import { ClawError } from "../errors.mjs";
export default Object.freeze({ prefix: "p", sinceSlice: 6, available: false, async handle() { throw new ClawError("NOT_AVAILABLE", { slice: 6 }); } });

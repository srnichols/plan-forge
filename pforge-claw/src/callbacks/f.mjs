import { ClawError } from "../errors.mjs";
export default Object.freeze({ prefix: "f", sinceSlice: 12, available: false, async handle() { throw new ClawError("NOT_AVAILABLE", { slice: 12 }); } });

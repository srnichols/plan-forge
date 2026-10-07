import { ClawError } from "../errors.mjs";
export default Object.freeze({ prefix: "x", sinceSlice: 14, available: false, async handle() { throw new ClawError("NOT_AVAILABLE", { slice: 14 }); } });

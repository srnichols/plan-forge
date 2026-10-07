import { ClawError } from "../errors.mjs";
export default Object.freeze({ prefix: "c", sinceSlice: 24, available: false, async handle() { throw new ClawError("NOT_AVAILABLE", { slice: 24 }); } });

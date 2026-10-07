import { ClawError } from "../errors.mjs";
export default Object.freeze({ prefix: "t", sinceSlice: 15, available: false, async handle() { throw new ClawError("NOT_AVAILABLE", { slice: 15 }); } });

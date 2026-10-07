import { ClawError } from "../errors.mjs";
export default Object.freeze({ prefix: "b", sinceSlice: 11, available: false, async handle() { throw new ClawError("NOT_AVAILABLE", { slice: 11 }); } });

import { ClawError } from "../errors.mjs";
export default Object.freeze({ prefix: "a", sinceSlice: 10, available: false, async handle() { throw new ClawError("NOT_AVAILABLE", { slice: 10 }); } });

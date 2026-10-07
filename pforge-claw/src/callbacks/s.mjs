import { ClawError } from "../errors.mjs";
export default Object.freeze({ prefix: "s", sinceSlice: 9, available: false, async handle() { throw new ClawError("NOT_AVAILABLE", { slice: 9 }); } });

import { ClawError } from "../errors.mjs";
export default Object.freeze({ prefix: "m", sinceSlice: 7, available: false, async handle() { throw new ClawError("NOT_AVAILABLE", { slice: 7 }); } });

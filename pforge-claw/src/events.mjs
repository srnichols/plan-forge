import { EventEmitter } from "node:events";

export const bus = new EventEmitter();
export const EVENT_NAMES = Object.freeze(["job.transition", "job.finished", "lane.event"]);

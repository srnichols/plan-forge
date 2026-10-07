import {
  bindTriageService,
  createTriageService,
} from "../capture.mjs";
import { createStt } from "../stt.mjs";

let service = null;
let unbind = null;
let channelWarningLogged = false;

export default {
  name: "capture",
  available: true,
  async start(ctx = {}) {
    await this.stop();
    const stt = createStt(ctx);
    service = createTriageService({ ...ctx, channel: ctx.channel, sttService: stt });
    unbind = bindTriageService(service);
    if (!ctx.channel && !channelWarningLogged) {
      channelWarningLogged = true;
      ctx.logger?.error?.("CAPTURE_CHANNEL_UNAVAILABLE", { code: "CAPTURE_CHANNEL_UNAVAILABLE" });
    }
  },
  async stop() {
    unbind?.();
    unbind = null;
    service = null;
  },
  snapshot() {
    return {
      voiceEnabled: service ? service.voiceEnabled : false,
      pending: service?.snapshot().pending ?? 0,
    };
  },
};

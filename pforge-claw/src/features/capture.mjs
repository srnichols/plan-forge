import {
  bindTriageService,
  createTriageService,
} from "../capture.mjs";
import { bindCaptureService, createCaptureService } from "../handlers/capture-commands.mjs";
import { createStt } from "../stt.mjs";

let service = null;
let unbind = null;
let unbindCapture = null;
let channelWarningLogged = false;

export default {
  name: "capture",
  available: true,
  async start(ctx = {}) {
    await this.stop();
    const stt = createStt(ctx);
    const captureService = createCaptureService({ ...ctx, channel: ctx.channel });
    unbindCapture = bindCaptureService(captureService);
    service = createTriageService({ ...ctx, channel: ctx.channel, sttService: stt, captureService });
    unbind = bindTriageService(service);
    if (!ctx.channel && !channelWarningLogged) {
      channelWarningLogged = true;
      ctx.logger?.error?.("CAPTURE_CHANNEL_UNAVAILABLE", { code: "CAPTURE_CHANNEL_UNAVAILABLE" });
    }
  },
  async stop() {
    unbind?.();
    unbind = null;
    unbindCapture?.();
    unbindCapture = null;
    service = null;
  },
  snapshot() {
    return {
      voiceEnabled: service ? service.voiceEnabled : false,
      pending: service?.snapshot().pending ?? 0,
    };
  },
};

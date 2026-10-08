import { runFeatureDoctorChecks } from "./doctor-checks.mjs";
import { FEATURES } from "./features/index.mjs";

export function createApp(ctx, { features = FEATURES } = {}) {
  const featureContext = { ...ctx, features };
  let started = [];
  let startPromise = null;
  let stopPromise = null;

  async function stopStarted() {
    const errors = [];
    for (const feature of [...started].reverse()) {
      try {
        await feature.stop?.(featureContext);
      } catch (error) {
        errors.push(error);
      }
    }
    started = [];
    if (errors.length) throw new AggregateError(errors, "One or more Claw features failed to stop.");
  }

  async function start() {
    if (startPromise) return startPromise;
    if (stopPromise) throw new Error("Cannot start a stopped Claw app.");
    startPromise = (async () => {
      try {
        for (const feature of features) {
          if (!feature?.available) continue;
          await feature.start?.(featureContext);
          started.push(feature);
        }
      } catch (error) {
        try {
          await stopStarted();
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], "Claw startup failed and rollback was incomplete.");
        }
        throw error;
      }
    })();
    return startPromise;
  }

  function stop() {
    if (!stopPromise) {
      stopPromise = (async () => {
        let startupError;
        if (startPromise) {
          try {
            await startPromise;
          } catch (error) {
            startupError = error;
          }
        }
        await stopStarted();
        if (startupError) throw startupError;
      })();
    }
    return stopPromise;
  }

  /** Live feature self-checks against the started features (never throws). */
  function doctor() {
    return runFeatureDoctorChecks({ features: started, ctx: { ...featureContext, live: true } });
  }

  return { start, stop, doctor };
}

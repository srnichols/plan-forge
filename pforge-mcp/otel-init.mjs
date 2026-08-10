/**
 * Optional OpenTelemetry initialization with activation gate.
 *
 * Activation is controlled by OTEL_ENABLED=true (or 1) or by setting
 * OTEL_EXPORTER_OTLP_ENDPOINT. When neither is set this module is a no-op:
 * initOtel() returns null so callers can skip telemetry paths without
 * conditional imports scattered across the codebase.
 *
 * The optional OTel packages (@opentelemetry/sdk-node,
 * @opentelemetry/auto-instrumentations-node) are loaded dynamically so the
 * server starts cleanly even when they are not installed.
 */

/** @returns {boolean} true when env gate is open */
export function isOtelEnabled() {
  return (
    process.env.OTEL_ENABLED === 'true' ||
    process.env.OTEL_ENABLED === '1' ||
    Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT)
  );
}

/**
 * Synchronous activation gate + async SDK bootstrap.
 *
 * Returns null immediately when the gate is closed (default).
 * Returns a Promise<sdk|null> when the gate is open so the caller can await
 * full SDK startup if desired.
 *
 * @returns {Promise<object>|null}
 */
export function initOtel() {
  if (!isOtelEnabled()) {
    return null;
  }
  return _startSdk();
}

async function _startSdk() {
  let NodeSDK, getNodeAutoInstrumentations;
  try {
    ({ NodeSDK } = await import('@opentelemetry/sdk-node'));
    ({ getNodeAutoInstrumentations } = await import(
      '@opentelemetry/auto-instrumentations-node'
    ));
  } catch (err) {
    // The gate was opened deliberately, so a missing package is a
    // misconfiguration rather than the expected no-op. `@opentelemetry/api` is a
    // required peer of sdk-node and npm silently drops it when it is declared
    // only in optionalDependencies, which disables tracing with no other signal.
    console.warn(
      `[otel] tracing was requested but the SDK could not load: ${err.message}\n` +
      '[otel] install the packages explicitly to enable it:\n' +
      '[otel]   npm i @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node',
    );
    return null;
  }

  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'plan-forge-mcp',
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
  return sdk;
}

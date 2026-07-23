import * as Sentry from '@sentry/node';

/**
 * Application error tracking (Technology doc: "Sentry for application error
 * tracking"). Initialised only when SENTRY_DSN is set, so local and CI runs
 * stay quiet and no telemetry leaves the box without explicit configuration.
 *
 * Must be called before the Nest app is created so instrumentation wraps the
 * HTTP layer.
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.APP_VERSION,
    // Sampled rather than 1.0 so tracing cost stays within the "<10% of revenue"
    // infrastructure budget; tune via env as volume grows.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  });
}

/** Reports an exception when Sentry is configured; a no-op otherwise. */
export function captureException(error: unknown): void {
  if (process.env.SENTRY_DSN) Sentry.captureException(error);
}

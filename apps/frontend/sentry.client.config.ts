import * as Sentry from '@sentry/nextjs';

/**
 * Sentry client-side initialization.
 *
 * Initialization order (important for Error Boundary error reporting):
 * 1. Next.js loads this file at module load time (via `instrumentation-client.ts`
 *    and/or `withSentryConfig` in `next.config.js`), before any React tree renders.
 * 2. `Sentry.init` runs synchronously here, so the SDK is ready before the
 *    Error Boundary's `componentDidCatch` can ever be invoked.
 * 3. The Error Boundary guards `Sentry.captureException` with `isSentryInitialized()`
 *    to avoid "Sentry not initialized" errors in edge cases (e.g. tests, SSR).
 *
 * Do not move `Sentry.init` into a component or lazy-load it — the Error Boundary
 * relies on the SDK being initialized at module load.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
  release: process.env.NEXT_PUBLIC_GIT_COMMIT_SHA || 'unknown',
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
  beforeSend(event, hint) {
    // Filter sensitive data
    if (event.request) {
      delete event.request.cookies;
    }
    return event;
  },
});

/**
 * Returns true once `Sentry.init` has completed for the current client.
 * The Error Boundary uses this guard before calling `captureException`
 * so that error reporting never throws when Sentry is unavailable
 * (e.g. during unit tests or before the client config has loaded).
 */
export function isSentryInitialized(): boolean {
  try {
    const client = Sentry.getClient();
    return Boolean(client && client.getDsn());
  } catch {
    return false;
  }
}
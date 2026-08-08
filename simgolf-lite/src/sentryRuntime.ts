import * as Sentry from "@sentry/react";
import type { Integration } from "@sentry/core/browser";
import type { ErrorInfo } from "react";
import { resolveSentryEnvironment, sanitizeSentryEvent } from "./sentryPrivacy";
import { normalizeUnhandledRejection, type NormalizedUnhandledRejection } from "./rejectionDiagnostics";

export const firstPartyGlobalHandlerOptions = {
  onerror: true,
  onunhandledrejection: false,
} as const;

/** Replace the SDK default in-place so window.onerror stays operational. */
export function configureSentryIntegrations(
  integrations: Integration[],
  createGlobalHandlers: (options: typeof firstPartyGlobalHandlerOptions) => Integration =
    Sentry.globalHandlersIntegration,
): Integration[] {
  return integrations.map((integration) =>
    integration.name === "GlobalHandlers"
      ? createGlobalHandlers(firstPartyGlobalHandlerOptions)
      : integration,
  );
}

export function initializeSentryRuntime(dsn: string): (error: Error, info: ErrorInfo) => string | undefined {
  Sentry.init({
    dsn,
    enabled: true,
    environment: resolveSentryEnvironment(window.location.hostname, import.meta.env.VITE_SENTRY_ENVIRONMENT),
    release: __APP_RELEASE__,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    // Retain global window errors, but replace the default rejection handler:
    // it can serialize arbitrary rejected values. Unhandled promises use the
    // normalized, first-party bridge exported from this module instead.
    integrations: configureSentryIntegrations,
    beforeBreadcrumb: () => null,
    beforeSend: sanitizeSentryEvent,
    initialScope: { tags: { app_version: __APP_VERSION__, commit_sha: __COMMIT_SHA__ } },
  });
  return (error, info) => {
    let eventId: string | undefined;
    Sentry.withScope((scope) => {
      scope.setContext("react", { componentStack: info.componentStack ?? undefined });
      eventId = Sentry.captureException(error);
    });
    return eventId;
  };
}

/** Capture only a normalized rejection and two fixed first-party markers. */
export function captureNormalizedUnhandledRejection(
  { error, shape }: NormalizedUnhandledRejection,
): string | undefined {
  let eventId: string | undefined;
  Sentry.withScope((scope) => {
    scope.setTag("error_origin", "window-unhandledrejection");
    scope.setTag("rejection_shape", shape);
    eventId = Sentry.captureException(error);
  });
  return eventId;
}

export function captureUnhandledRejection(reason: unknown): string | undefined {
  return captureNormalizedUnhandledRejection(normalizeUnhandledRejection(reason));
}

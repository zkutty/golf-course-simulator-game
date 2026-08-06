import * as Sentry from "@sentry/react";
import type { ErrorInfo } from "react";
import { resolveSentryEnvironment, sanitizeSentryEvent } from "./sentryPrivacy";

export function initializeSentryRuntime(dsn: string): (error: Error, info: ErrorInfo) => string | undefined {
  Sentry.init({
    dsn,
    enabled: true,
    environment: resolveSentryEnvironment(window.location.hostname, import.meta.env.VITE_SENTRY_ENVIRONMENT),
    release: __APP_RELEASE__,
    sendDefaultPii: false,
    tracesSampleRate: 0,
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

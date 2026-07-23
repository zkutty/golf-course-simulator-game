import * as Sentry from "@sentry/react";
import type { ErrorInfo } from "react";
import type { ErrorEvent as SentryErrorEvent } from "@sentry/react";

function withoutQueryOrFragment(url: string | undefined): string | undefined {
  return url?.split(/[?#]/, 1)[0];
}

/** Keep crash reports useful without sending player identity, saves, or state. */
export function sanitizeSentryEvent(event: SentryErrorEvent): SentryErrorEvent {
  const sanitized: SentryErrorEvent = {
    ...event,
    user: undefined,
    breadcrumbs: undefined,
    extra: undefined,
  };
  if (event.request) {
    sanitized.request = {
      ...event.request,
      url: withoutQueryOrFragment(event.request.url),
      cookies: undefined,
      data: undefined,
      headers: undefined,
    };
  }
  return sanitized;
}

function installCloudflareWebAnalytics(): void {
  const token = import.meta.env.VITE_CF_WEB_ANALYTICS_TOKEN?.trim();
  if (!import.meta.env.PROD || !token || document.querySelector("script[data-cf-beacon]")) return;
  const beacon = document.createElement("script");
  beacon.defer = true;
  beacon.src = "https://static.cloudflareinsights.com/beacon.min.js";
  beacon.dataset.cfBeacon = JSON.stringify({ token });
  document.head.append(beacon);
}

export function initializeMonitoring(): void {
  installCloudflareWebAnalytics();
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();
  if (!import.meta.env.PROD || !dsn) return;

  Sentry.init({
    dsn,
    enabled: true,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT?.trim() || "playtest",
    release: __APP_RELEASE__,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeBreadcrumb: () => null,
    beforeSend: sanitizeSentryEvent,
    initialScope: {
      tags: {
        app_version: __APP_VERSION__,
        commit_sha: __COMMIT_SHA__,
      },
    },
  });
}

export function reportAppError(error: Error, info: ErrorInfo): void {
  if (!import.meta.env.PROD || !import.meta.env.VITE_SENTRY_DSN) return;
  Sentry.withScope((scope) => {
    scope.setContext("react", { componentStack: info.componentStack ?? undefined });
    Sentry.captureException(error);
  });
}

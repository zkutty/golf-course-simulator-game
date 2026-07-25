import * as Sentry from "@sentry/react";
import type { ErrorInfo } from "react";
import type { ErrorEvent as SentryErrorEvent } from "@sentry/react";

function withoutQueryOrFragment(url: string | undefined): string | undefined {
  return url?.split(/[?#]/, 1)[0];
}

function safeContext(
  context: Record<string, unknown> | undefined,
  keys: readonly string[],
): Record<string, unknown> | undefined {
  if (!context) return undefined;
  const entries = keys
    .filter((key) => typeof context[key] === "string" || typeof context[key] === "number" || typeof context[key] === "boolean")
    .map((key) => [key, context[key]]);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function sanitizeContexts(contexts: SentryErrorEvent["contexts"]): SentryErrorEvent["contexts"] {
  if (!contexts) return undefined;
  const sanitized = {
    app: safeContext(contexts.app, ["app_name", "app_version", "build_type"]),
    browser: safeContext(contexts.browser, ["name", "version"]),
    os: safeContext(contexts.os, ["name", "version"]),
    react: safeContext(contexts.react, ["componentStack"]),
  };
  return Object.values(sanitized).some(Boolean) ? sanitized : undefined;
}

function sanitizeTags(tags: SentryErrorEvent["tags"]): SentryErrorEvent["tags"] {
  if (!tags) return undefined;
  const sanitized = Object.fromEntries(
    ["app_version", "commit_sha"]
      .filter((key) => tags[key] !== undefined)
      .map((key) => [key, tags[key]]),
  );
  return Object.keys(sanitized).length ? sanitized : undefined;
}

/** Keep crash reports useful without sending player identity, saves, or state. */
export function sanitizeSentryEvent(event: SentryErrorEvent): SentryErrorEvent {
  const requestUrl = withoutQueryOrFragment(event.request?.url);
  const request = event.request && (requestUrl || event.request.method)
    ? {
        ...(requestUrl ? { url: requestUrl } : {}),
        ...(event.request.method ? { method: event.request.method } : {}),
      }
    : undefined;
  const sanitized: SentryErrorEvent = {
    ...event,
    user: undefined,
    breadcrumbs: undefined,
    extra: undefined,
    contexts: sanitizeContexts(event.contexts),
    tags: sanitizeTags(event.tags),
    logentry: event.logentry?.message ? { message: event.logentry.message } : undefined,
    measurements: undefined,
    request,
    sdkProcessingMetadata: undefined,
    server_name: undefined,
    spans: undefined,
    transaction: undefined,
    transaction_info: undefined,
  };
  return sanitized;
}

export function cloudflareBeaconConfiguration(token: string): { token: string; spa: true } {
  return { token, spa: true };
}

function installCloudflareWebAnalytics(): void {
  const token = import.meta.env.VITE_CF_WEB_ANALYTICS_TOKEN?.trim();
  if (!import.meta.env.PROD || !token || document.querySelector("script[data-cf-beacon]")) return;
  const beacon = document.createElement("script");
  beacon.defer = true;
  beacon.src = "https://static.cloudflareinsights.com/beacon.min.js";
  beacon.dataset.cfBeacon = JSON.stringify(cloudflareBeaconConfiguration(token));
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

export function reportAppError(error: Error, info: ErrorInfo): string | undefined {
  if (!import.meta.env.PROD || !import.meta.env.VITE_SENTRY_DSN) return undefined;
  let eventId: string | undefined;
  Sentry.withScope((scope) => {
    scope.setContext("react", { componentStack: info.componentStack ?? undefined });
    eventId = Sentry.captureException(error);
  });
  return eventId;
}

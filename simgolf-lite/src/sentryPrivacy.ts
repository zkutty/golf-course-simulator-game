import type { ErrorEvent as SentryErrorEvent } from "@sentry/react";

function withoutQueryOrFragment(url: string | undefined): string | undefined {
  return url?.split(/[?#]/, 1)[0];
}

function safeContext(context: Record<string, unknown> | undefined, keys: readonly string[]): Record<string, unknown> | undefined {
  if (!context) return undefined;
  const entries = keys.filter((key) => typeof context[key] === "string" || typeof context[key] === "number" || typeof context[key] === "boolean").map((key) => [key, context[key]]);
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
  const sanitized = Object.fromEntries(["app_version", "commit_sha"].filter((key) => tags[key] !== undefined).map((key) => [key, tags[key]]));
  return Object.keys(sanitized).length ? sanitized : undefined;
}

/** Keep crash reports useful without sending player identity, saves, or state. */
export function sanitizeSentryEvent(event: SentryErrorEvent): SentryErrorEvent {
  const requestUrl = withoutQueryOrFragment(event.request?.url);
  const request = event.request && (requestUrl || event.request.method)
    ? { ...(requestUrl ? { url: requestUrl } : {}), ...(event.request.method ? { method: event.request.method } : {}) }
    : undefined;
  return {
    ...event, user: undefined, breadcrumbs: undefined, extra: undefined,
    contexts: sanitizeContexts(event.contexts), tags: sanitizeTags(event.tags),
    logentry: event.logentry?.message ? { message: event.logentry.message } : undefined,
    measurements: undefined, request, sdkProcessingMetadata: undefined, server_name: undefined,
    spans: undefined, transaction: undefined, transaction_info: undefined,
  };
}

export function resolveSentryEnvironment(hostname: string, override?: string): string {
  const explicit = override?.trim();
  if (explicit) return explicit;
  switch (hostname) {
    case "coursecraftgame.com":
    case "www.coursecraftgame.com":
    case "coursecraft-playtest.zbkutlow.workers.dev":
      return "production";
    case "coursecraft-dev.zbkutlow.workers.dev":
      return "staging";
    default:
      return "unknown";
  }
}

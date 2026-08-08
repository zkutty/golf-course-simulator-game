import { describe, expect, it, vi } from "vitest";
import type { Integration } from "@sentry/core/browser";
import {
  cloudflareBeaconConfiguration,
  coalescePendingUnhandledRejection,
  monitoringHasSentryDsn,
} from "./monitoringRuntime";
import { resolveSentryEnvironment, sanitizeSentryEvent } from "./sentryPrivacy";
import { configureSentryIntegrations, firstPartyGlobalHandlerOptions } from "./sentryRuntime";
import { normalizeUnhandledRejection } from "./rejectionDiagnostics";

describe("monitoring privacy", () => {
  it("only defers the Sentry SDK for production builds with a nonblank DSN", () => {
    expect(monitoringHasSentryDsn(true, " configured ")).toBe(true);
    expect(monitoringHasSentryDsn(false, "configured")).toBe(false);
    expect(monitoringHasSentryDsn(true, "   ")).toBe(false);
    expect(monitoringHasSentryDsn(true, undefined)).toBe(false);
  });

  it("keeps only allowlisted diagnostic fields", () => {
    const sanitized = sanitizeSentryEvent({
      type: undefined,
      message: "render failed",
      user: { id: "tester-1", email: "tester@example.com" },
      breadcrumbs: [{ category: "ui.click", message: "New Game" }],
      extra: { save: { cash: 1000 } },
      logentry: { message: "render failed", params: [{ save: "private" }] },
      tags: {
        app_version: "1.0.0",
        commit_sha: "abc123",
        course_id: "private-course",
        error_origin: "window-unhandledrejection",
        rejection_shape: "object",
        unsafe_rejection_shape: "private",
      },
      contexts: {
        app: { app_name: "CourseCraft", app_version: "1.0.0", free_memory: 100 },
        browser: { name: "Chrome", version: "140", courseName: "Private Club" },
        device: { device_unique_identifier: "device-1" },
        os: { name: "macOS", version: "26.0", build: "private-build" },
        react: { componentStack: "at App", save: { cash: 1000 } },
        response: { cookies: { session: "secret" }, headers: { authorization: "secret" } },
        state: { state: { type: "game", value: { cash: 1000 } } },
      },
      request: {
        url: "https://coursecraft.workers.dev/?course=private#hole-1",
        method: "GET",
        query_string: { course: "private" },
        cookies: { session: "secret" },
        data: { courseName: "Private Club" },
        env: { REMOTE_ADDR: "192.0.2.1" },
        headers: { authorization: "secret" },
      },
      transaction: "/course/private",
      spans: [{ span_id: "span", trace_id: "trace", start_timestamp: 0, timestamp: 1, data: { save: "private" } }],
      measurements: { cash: { value: 1000, unit: "none" } },
      sdkProcessingMetadata: { save: "private" },
      server_name: "tester-machine",
    });

    expect(sanitized.user).toBeUndefined();
    expect(sanitized.breadcrumbs).toBeUndefined();
    expect(sanitized.extra).toBeUndefined();
    expect(sanitized.logentry).toEqual({ message: "render failed" });
    expect(sanitized.tags).toEqual({
      app_version: "1.0.0",
      commit_sha: "abc123",
      error_origin: "window-unhandledrejection",
      rejection_shape: "object",
    });
    expect(sanitized.contexts).toEqual({
      app: { app_name: "CourseCraft", app_version: "1.0.0" },
      browser: { name: "Chrome", version: "140" },
      os: { name: "macOS", version: "26.0" },
      react: { componentStack: "at App" },
    });
    expect(sanitized.request).toEqual({
      url: "https://coursecraft.workers.dev/",
      method: "GET",
    });
    expect(sanitized.transaction).toBeUndefined();
    expect(sanitized.spans).toBeUndefined();
    expect(sanitized.measurements).toBeUndefined();
    expect(sanitized.sdkProcessingMetadata).toBeUndefined();
    expect(sanitized.server_name).toBeUndefined();
  });

  it("explicitly enables Cloudflare SPA route measurement", () => {
    expect(cloudflareBeaconConfiguration("site-token")).toEqual({
      token: "site-token",
      spa: true,
    });
  });

  it("rejects nonliteral rejection markers instead of expanding the tag allowlist", () => {
    const sanitized = sanitizeSentryEvent({
      type: undefined,
      tags: {
        error_origin: "window-error",
        rejection_shape: "private-value",
      },
    });

    expect(sanitized.tags).toBeUndefined();
  });

  it("keeps window.onerror while disabling only SDK unhandled-rejection capture", () => {
    const integrations = [
      { name: 'GlobalHandlers' },
      { name: 'AfterGlobalHandlers' },
    ] as Integration[]
    const replacement = { name: 'GlobalHandlers' } as Integration
    const createGlobalHandlers = vi.fn(() => replacement)

    const configured = configureSentryIntegrations(integrations, createGlobalHandlers)

    expect(firstPartyGlobalHandlerOptions).toEqual({
      onerror: true,
      onunhandledrejection: false,
    })
    expect(configured).toHaveLength(2)
    expect(configured[0]?.name).toBe('GlobalHandlers')
    expect(configured[1]?.name).toBe('AfterGlobalHandlers')
    expect(configured[0]).toBe(replacement)
    expect(createGlobalHandlers).toHaveBeenCalledOnce()
    expect(createGlobalHandlers).toHaveBeenCalledWith(firstPartyGlobalHandlerOptions)
  });

  it("coalesces repeated normalized rejection events while initialization is unavailable", () => {
    const pending = new Map()
    for (let index = 0; index < 100; index += 1) {
      coalescePendingUnhandledRejection(pending, normalizeUnhandledRejection(`secret-${index}`))
    }
    coalescePendingUnhandledRejection(pending, normalizeUnhandledRejection({ token: 'private' }))

    // A failed dynamic import leaves this map in memory for the next retry;
    // it remains bounded to the fixed classification vocabulary.
    expect(pending.size).toBe(2)
    expect([...pending.keys()]).toEqual(['string', 'object'])
    expect(JSON.stringify([...pending.values()])).not.toContain('secret-')
    expect(JSON.stringify([...pending.values()])).not.toContain('private')
  });
});

describe("sentry environment resolution", () => {
  it("tags every hostname the production Worker is served from", () => {
    // wrangler.jsonc keeps workers_dev enabled for the production environment,
    // so the workers.dev URL stays reachable whether or not a custom domain
    // is bound. Both must report production.
    expect(resolveSentryEnvironment("coursecraft-playtest.zbkutlow.workers.dev")).toBe("production");
    expect(resolveSentryEnvironment("coursecraftgame.com")).toBe("production");
    expect(resolveSentryEnvironment("www.coursecraftgame.com")).toBe("production");
  });

  it("tags the pre-production Worker as staging", () => {
    expect(resolveSentryEnvironment("coursecraft-dev.zbkutlow.workers.dev")).toBe("staging");
  });

  it("never reports an unrecognized hostname as production", () => {
    for (const hostname of ["localhost", "127.0.0.1", "example.com", ""]) {
      expect(resolveSentryEnvironment(hostname)).toBe("unknown");
    }
  });

  it("lets an explicit build-time environment win over the hostname", () => {
    // The GitHub Pages fallback build set this explicitly; keep the override
    // path working for any deploy lane that can tag itself at build time.
    expect(resolveSentryEnvironment("coursecraftgame.com", "github-pages")).toBe("github-pages");
    expect(resolveSentryEnvironment("coursecraft-dev.zbkutlow.workers.dev", "  staging  ")).toBe(
      "staging",
    );
  });

  it("ignores a blank override instead of tagging releases with an empty string", () => {
    expect(resolveSentryEnvironment("coursecraftgame.com", "   ")).toBe("production");
    expect(resolveSentryEnvironment("coursecraftgame.com", undefined)).toBe("production");
  });
});

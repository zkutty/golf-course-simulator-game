import { describe, expect, it } from "vitest";
import {
  cloudflareBeaconConfiguration,
  monitoringHasSentryDsn,
} from "./monitoringRuntime";
import { resolveSentryEnvironment, sanitizeSentryEvent } from "./sentryPrivacy";

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
      tags: { app_version: "1.0.0", commit_sha: "abc123", course_id: "private-course" },
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
    expect(sanitized.tags).toEqual({ app_version: "1.0.0", commit_sha: "abc123" });
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

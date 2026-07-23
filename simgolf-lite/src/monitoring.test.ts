import { describe, expect, it } from "vitest";
import { sanitizeSentryEvent } from "./monitoring";

describe("monitoring privacy", () => {
  it("removes player-identifying and state-bearing crash fields", () => {
    const sanitized = sanitizeSentryEvent({
      type: undefined,
      message: "render failed",
      user: { id: "tester-1", email: "tester@example.com" },
      breadcrumbs: [{ category: "ui.click", message: "New Game" }],
      extra: { save: { cash: 1000 } },
      request: {
        url: "https://coursecraft.workers.dev/?course=private#hole-1",
        cookies: { session: "secret" },
        data: { courseName: "Private Club" },
        headers: { authorization: "secret" },
      },
    });

    expect(sanitized.user).toBeUndefined();
    expect(sanitized.breadcrumbs).toBeUndefined();
    expect(sanitized.extra).toBeUndefined();
    expect(sanitized.request).toEqual({
      url: "https://coursecraft.workers.dev/",
      cookies: undefined,
      data: undefined,
      headers: undefined,
    });
  });
});

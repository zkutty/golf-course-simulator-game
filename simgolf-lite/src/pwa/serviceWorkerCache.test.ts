import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

// Exercise the shipping fetch handler, rather than copying its routing or cache policy.
const source = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
const origin = "https://coursecraft.test";
interface RequestInput { url: string; method: string; mode: string }
interface ResponseInput { status: number; ok: boolean; type: string; clone(): ResponseInput }
interface FetchEvent { request: RequestInput; respondWith(value: Promise<ResponseInput>): void }

function handler(response: ResponseInput = new Response("complete audio fixture")) {
  const listeners = new Map<string, (event: FetchEvent) => void>();
  const cache = { put: vi.fn(async (_request: unknown, value: ResponseInput) => {
    // Real installed Chromium separately proves this platform rejection contract.
    if (value.status === 206) throw new TypeError("Partial response (status code 206) is unsupported");
  }) };
  const caches = { open: vi.fn(async () => cache), match: vi.fn(async (_request: unknown, _options?: unknown): Promise<ResponseInput | undefined> => undefined) };
  const fetch = vi.fn(async (_request: RequestInput) => response);
  runInNewContext(source, {
    URL, location: { origin }, caches, fetch,
    self: { registration: { scope: origin + "/" }, addEventListener: (name: string, listener: (event: FetchEvent) => void) => listeners.set(name, listener) },
  });
  const request = (path: string, patch: Partial<RequestInput> = {}) => {
    const input = { url: origin + path, method: "GET", mode: "cors", ...patch };
    let promise: Promise<ResponseInput> | undefined;
    listeners.get("fetch")!({ request: input, respondWith: (value) => { promise = value; } });
    return { input, promise };
  };
  return { request, caches, cache, fetch };
}

describe("shipping service-worker cache-first responses", () => {
  it("forwards the identical partial audio response and never tries a partial cache write", async () => {
    const response = new Response("partial", { status: 206, headers: { "Content-Range": "bytes 0-6/14", "Content-Type": "audio/mpeg" } });
    const h = handler(response), event = h.request("/audio/music/suno/title-01.mp3");
    expect(await event.promise).toBe(response);
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 0-6/14");
    expect(await response.text()).toBe("partial");
    expect(h.cache.put).not.toHaveBeenCalled();
  });
  it("still caches a clone of a complete audio response while forwarding the original", async () => {
    const response = new Response("complete audio fixture", { headers: { "Content-Type": "audio/mpeg" } });
    const h = handler(response), event = h.request("/audio/music/suno/title-01.mp3");
    expect(await event.promise).toBe(response);
    expect(h.cache.put).toHaveBeenCalledTimes(1);
    const [key, cached] = h.cache.put.mock.calls[0];
    expect(key).toBe(event.input); expect(cached).not.toBe(response);
    expect(await (cached as Response).text()).toBe("complete audio fixture");
  });
  it("preserves opaque response caching", async () => {
    const clone = { status: 0, ok: false, type: "opaque", clone: () => clone };
    const response = { status: 0, ok: false, type: "opaque", clone: vi.fn(() => clone) };
    const h = handler(response), event = h.request("/audio/opaque.mp3");
    expect(await event.promise).toBe(response); expect(h.cache.put).toHaveBeenCalledWith(event.input, clone);
  });
  it("serves a complete cached audio response offline without fetching or rewriting it", async () => {
    const cached = new Response("offline complete audio"); const h = handler(); h.caches.match.mockResolvedValue(cached);
    expect(await h.request("/audio/music/suno/title-01.mp3").promise).toBe(cached);
    expect(h.fetch).not.toHaveBeenCalled(); expect(h.cache.put).not.toHaveBeenCalled();
  });
  it("leaves runtime API requests outside the service worker", () => {
    const h = handler(); expect(h.request("/api/bug-reports/config").promise).toBeUndefined();
    expect(h.fetch).not.toHaveBeenCalled(); expect(h.caches.match).not.toHaveBeenCalled();
  });
  it("leaves non-GET requests outside the service worker", () => {
    const h = handler(); expect(h.request("/audio/music/suno/title-01.mp3", { method: "POST" }).promise).toBeUndefined();
    expect(h.fetch).not.toHaveBeenCalled(); expect(h.caches.match).not.toHaveBeenCalled();
  });
  it("retains selected-atlas runtime caching without fetching unrelated assets", async () => {
    const response = new Response("selected atlas"); const h = handler(response), event = h.request("/atlases/biomes/parkland.png");
    expect(await event.promise).toBe(response); expect(h.fetch).toHaveBeenCalledExactlyOnceWith(event.input);
    expect(h.cache.put).toHaveBeenCalledTimes(1); expect(h.cache.put.mock.calls[0][0]).toBe(event.input);
  });
  it("retains cached-shell navigation fallback when the network is offline", async () => {
    const cached = new Response("offline shell"); const h = handler(); h.fetch.mockRejectedValue(new TypeError("offline")); h.caches.match.mockResolvedValue(cached);
    expect(await h.request("/", { mode: "navigate" }).promise).toBe(cached);
    expect(h.caches.match).toHaveBeenCalledWith(origin + "/"); expect(h.cache.put).not.toHaveBeenCalled();
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedOverlayUrl, isReservedShortcut, normalizeWindowMode, restoreWindowBounds, sanitizeAchievementIds, sanitizePresence } from "./desktopPolicy.mjs";

test("window restoration clamps an unplugged display to reachable controls", () => {
  assert.deepEqual(restoreWindowBounds({ x: -9000, y: 9000, width: 5000, height: 5000 }, { workArea: { x: 100, y: 50, width: 1600, height: 900 } }), {
    x: 100,
    y: 50,
    width: 1600,
    height: 900,
  });
  assert.equal(normalizeWindowMode("unknown"), "windowed");
});

test("platform-facing values are stable and restricted", () => {
  assert.equal(isAllowedOverlayUrl("https://steamcommunity.com/sharedfiles/filedetails?id=1"), true);
  assert.equal(isAllowedOverlayUrl("http://steamcommunity.com/"), false);
  assert.equal(isAllowedOverlayUrl("https://evil.example/?token=secret"), false);
  assert.equal(isReservedShortcut("Alt+F4"), true);
  assert.equal(isReservedShortcut("Ctrl+KeyS"), false);
  assert.equal(sanitizePresence("playing"), "playing");
  assert.equal(sanitizePresence("Course with private name"), null);
  assert.deepEqual(sanitizeAchievementIds(["first-hole", "first-hole", "bad id", "safe.id"]), ["first-hole", "safe.id"]);
});

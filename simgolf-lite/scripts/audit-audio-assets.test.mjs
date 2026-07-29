import assert from "node:assert/strict";
import test from "node:test";
import { compareAudioAssetSets } from "./audit-audio-assets.mjs";

const expected = new Set(["audio/music/suno/title-01.mp3"]);

test("audio audit accepts only the manifest-owned Suno runtime set", () => {
  const result = compareAudioAssetSets({
    expected,
    publicActual: new Set(expected),
    distActual: new Set(expected),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.public.rootLevelLegacy, []);
});

test("audio audit rejects root-level legacy media before it can ship", () => {
  const publicActual = new Set([...expected, "audio/menu-theme.mp3"]);
  const result = compareAudioAssetSets({ expected, publicActual, distActual: new Set(expected) });

  assert.equal(result.ok, false);
  assert.deepEqual(result.public.rootLevelLegacy, ["audio/menu-theme.mp3"]);
  assert.deepEqual(result.public.extra, ["audio/menu-theme.mp3"]);
});

test("audio audit rejects a non-Suno recording in the release artifact", () => {
  const distActual = new Set([...expected, "audio/music/legacy/clubhouse.ogg"]);
  const result = compareAudioAssetSets({ expected, publicActual: new Set(expected), distActual });

  assert.equal(result.ok, false);
  assert.deepEqual(result.dist.extra, ["audio/music/legacy/clubhouse.ogg"]);
});

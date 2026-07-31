import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  auditAudioProvenanceSource,
  compareAudioAssetSets,
  inspectMp3EncodingBuffer,
} from "./audit-audio-assets.mjs";

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

test("audio audit requires explicit per-track production provenance", () => {
  const source = readFileSync(new URL("../src/audio/sunoLibrary.ts", import.meta.url), "utf8");
  assert.deepEqual(auditAudioProvenanceSource(source), { ok: true, errors: [], assetCount: 40 });

  const commentOnly = `// ${[
    "provenance: SUNO_PROVENANCE",
    'status: "pending-release-audit"',
    'runtimeFormat: "MP3"',
    "bitrateKbps: 96",
    'mode: "sequential-playlist"',
    "overlappingCrossfade: false",
    'status: "unmeasured"',
  ].join("\n// ")}`;
  const commentResult = auditAudioProvenanceSource(commentOnly);
  assert.equal(commentResult.ok, false);
  assert.equal(commentResult.assetCount, 0);

  const missingPerAsset = auditAudioProvenanceSource(
    source.replace("provenance: SUNO_PROVENANCE,", "provenance: undefined,"),
  );
  assert.equal(missingPerAsset.ok, false);
  assert.ok(missingPerAsset.errors.includes("asset() must attach structured SUNO_PROVENANCE to every returned asset"));

  const malformed = auditAudioProvenanceSource(source.replace("bitrateKbps: 96,", "bitrateKbps: 128,"));
  assert.equal(malformed.ok, false);
  assert.ok(malformed.errors.includes("SUNO_PROVENANCE must match the complete structured production schema"));
});

test("audio audit reads MP3 codec and bitrate from shipped frame bytes", () => {
  const bitrateIndexes = new Map([[96, 7], [128, 9]]);
  const sampleRateIndexes = new Map([[44_100, 0], [48_000, 1]]);
  const frame = ({ bitrateKbps = 96, sampleRateHz = 44_100, marker = "" } = {}) => {
    const length = Math.floor(144_000 * bitrateKbps / sampleRateHz);
    const output = Buffer.alloc(length);
    output.set([
      0xff,
      0xfb,
      (bitrateIndexes.get(bitrateKbps) << 4) | (sampleRateIndexes.get(sampleRateHz) << 2),
      0,
    ]);
    if (marker) output.write(marker, 36, "ascii");
    return output;
  };
  const id3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0]);
  const valid = Buffer.concat([id3, frame(), frame(), frame()]);
  assert.deepEqual(
    inspectMp3EncodingBuffer(valid),
    {
      codec: "mp3",
      bitrateKbps: 96,
      sampleRateHz: 44_100,
      framesValidated: 3,
      constantBitrate: true,
      vbrHeader: false,
    },
  );
  const invalid = {
    codec: "unknown",
    bitrateKbps: null,
    sampleRateHz: null,
    framesValidated: 0,
    constantBitrate: false,
    vbrHeader: false,
  };
  assert.deepEqual(inspectMp3EncodingBuffer(Buffer.from("not audio")), invalid);
  assert.deepEqual(inspectMp3EncodingBuffer(frame()), { ...invalid, framesValidated: 1 });
  assert.deepEqual(
    inspectMp3EncodingBuffer(Buffer.concat([frame(), frame(), frame().subarray(0, 100)])),
    { ...invalid, framesValidated: 2 },
  );
  assert.deepEqual(
    inspectMp3EncodingBuffer(Buffer.concat([frame(), frame({ bitrateKbps: 128 }), frame()])),
    { ...invalid, framesValidated: 1 },
  );
  assert.deepEqual(
    inspectMp3EncodingBuffer(Buffer.concat([frame(), frame(), frame({ sampleRateHz: 48_000 })])),
    { ...invalid, framesValidated: 2 },
  );
  assert.deepEqual(
    inspectMp3EncodingBuffer(Buffer.concat([frame(), frame(), frame(), frame({ bitrateKbps: 128 })])),
    { ...invalid, framesValidated: 3 },
  );
  assert.deepEqual(
    inspectMp3EncodingBuffer(Buffer.concat([frame(), frame(), frame(), frame().subarray(0, 100)])),
    { ...invalid, framesValidated: 3 },
  );
  assert.deepEqual(
    inspectMp3EncodingBuffer(Buffer.concat([frame(), frame(), frame(), Buffer.from("corrupt tail")])),
    { ...invalid, framesValidated: 3 },
  );
  const id3v1 = Buffer.alloc(128);
  id3v1.write("TAG", 0, "ascii");
  assert.deepEqual(
    inspectMp3EncodingBuffer(Buffer.concat([frame(), frame(), frame(), id3v1])),
    {
      codec: "mp3",
      bitrateKbps: 96,
      sampleRateHz: 44_100,
      framesValidated: 3,
      constantBitrate: true,
      vbrHeader: false,
    },
  );
  for (const marker of ["Xing", "VBRI"]) {
    assert.deepEqual(
      inspectMp3EncodingBuffer(Buffer.concat([frame({ marker }), frame(), frame()])),
      {
        codec: "mp3",
        bitrateKbps: 96,
        sampleRateHz: 44_100,
        framesValidated: 0,
        constantBitrate: false,
        vbrHeader: true,
      },
    );
  }
});

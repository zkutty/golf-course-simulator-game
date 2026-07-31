import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const mediaPattern = /\.(?:aac|flac|m4a|mp3|ogg|wav)$/i;
const assetPattern = /asset\(\s*"[^"]+"\s*,\s*"[^"]+"\s*,\s*"[^"]+"\s*,\s*"(music|ambience)"\s*,\s*"([^"]+)"\s*\)/g;

function mediaFiles(directory) {
  const files = [];
  function walk(current) {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (mediaPattern.test(name)) files.push(relative(directory, path).split(sep).join("/"));
    }
  }
  walk(directory);
  return new Set(files);
}

function difference(left, right) {
  return [...left].filter((item) => !right.has(item)).sort();
}

const expectedProvenance = {
  source: {
    kind: "suno-generation",
    creator: "Zach Kutlow",
    generatedOn: "2026-07-24",
  },
  license: {
    status: "pending-release-audit",
    basis: "subscribed-owner-account",
  },
  mastering: {
    runtimeFormat: "MP3",
    bitrateKbps: 96,
    treatment: "source-export-no-project-remaster-documented",
  },
  loop: {
    mode: "sequential-playlist",
    seamless: false,
    overlappingCrossfade: false,
  },
  loudness: {
    status: "unmeasured",
    runtimeControl: "master-and-channel-gain",
  },
};

function propertyName(node) {
  return ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : null;
}

function unwrapFreeze(node) {
  if (
    ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === "Object"
    && node.expression.name.text === "freeze"
    && node.arguments.length === 1
  ) {
    return node.arguments[0];
  }
  return node;
}

function astValue(input) {
  const node = unwrapFreeze(input);
  if (ts.isObjectLiteralExpression(node)) {
    const output = {};
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) return undefined;
      const name = propertyName(property.name);
      const value = astValue(property.initializer);
      if (name == null || value === undefined) return undefined;
      output[name] = value;
    }
    return output;
  }
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  return undefined;
}

function findDescendants(node, predicate, output = []) {
  if (!node) return output;
  if (predicate(node)) output.push(node);
  ts.forEachChild(node, (child) => {
    findDescendants(child, predicate, output);
  });
  return output;
}

export function auditAudioProvenanceSource(source) {
  const sourceFile = ts.createSourceFile("sunoLibrary.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const errors = [];
  const declarations = findDescendants(
    sourceFile,
    (node) => ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "SUNO_PROVENANCE",
  );
  const resolved = declarations.length === 1 && declarations[0].initializer
    ? astValue(declarations[0].initializer)
    : undefined;
  if (JSON.stringify(resolved) !== JSON.stringify(expectedProvenance)) {
    errors.push("SUNO_PROVENANCE must match the complete structured production schema");
  }

  const assetFunctions = findDescendants(
    sourceFile,
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "asset",
  );
  const returns = assetFunctions.length === 1
    ? findDescendants(assetFunctions[0].body, (node) => ts.isReturnStatement(node))
    : [];
  const returnObject = returns.length === 1 && returns[0].expression
    ? unwrapFreeze(returns[0].expression)
    : undefined;
  const provenanceProperty = returnObject && ts.isObjectLiteralExpression(returnObject)
    ? returnObject.properties.find((property) =>
        ts.isPropertyAssignment(property) && propertyName(property.name) === "provenance"
      )
    : undefined;
  if (
    !provenanceProperty
    || !ts.isPropertyAssignment(provenanceProperty)
    || !ts.isIdentifier(provenanceProperty.initializer)
    || provenanceProperty.initializer.text !== "SUNO_PROVENANCE"
  ) {
    errors.push("asset() must attach structured SUNO_PROVENANCE to every returned asset");
  }

  const assetCalls = findDescendants(
    sourceFile,
    (node) => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "asset",
  );
  if (assetCalls.length !== 40) errors.push(`expected 40 provenance-backed asset records, found ${assetCalls.length}`);
  const malformedCalls = assetCalls.filter((call) =>
    call.arguments.length !== 5
    || call.arguments.some((argument) => !ts.isStringLiteral(argument))
    || !["music", "ambience"].includes(call.arguments[3]?.text)
  );
  if (malformedCalls.length) errors.push(`${malformedCalls.length} asset record(s) have malformed provenance inputs`);
  return { ok: errors.length === 0, errors, assetCount: assetCalls.length };
}

export function inspectMp3EncodingBuffer(buffer) {
  let offset = 0;
  if (buffer.length >= 10 && buffer.subarray(0, 3).toString("ascii") === "ID3") {
    const size = ((buffer[6] & 0x7f) << 21)
      | ((buffer[7] & 0x7f) << 14)
      | ((buffer[8] & 0x7f) << 7)
      | (buffer[9] & 0x7f);
    offset = 10 + size;
  }

  const bitrateTables = {
    mpeg1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    mpeg2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  };
  const sampleRates = [44_100, 48_000, 32_000];
  const readHeader = (index) => {
    if (index + 4 > buffer.length || buffer[index] !== 0xff || (buffer[index + 1] & 0xe0) !== 0xe0) return null;
    const versionBits = (buffer[index + 1] >> 3) & 0x03;
    const layerBits = (buffer[index + 1] >> 1) & 0x03;
    const bitrateIndex = (buffer[index + 2] >> 4) & 0x0f;
    const sampleRateIndex = (buffer[index + 2] >> 2) & 0x03;
    if (
      versionBits === 1
      || layerBits !== 1
      || bitrateIndex === 0
      || bitrateIndex === 15
      || sampleRateIndex === 3
    ) return null;
    const mpeg1 = versionBits === 3;
    const sampleRateScale = mpeg1 ? 1 : versionBits === 2 ? 0.5 : 0.25;
    const bitrateKbps = (mpeg1 ? bitrateTables.mpeg1 : bitrateTables.mpeg2)[bitrateIndex];
    const sampleRateHz = sampleRates[sampleRateIndex] * sampleRateScale;
    const padding = (buffer[index + 2] >> 1) & 0x01;
    const frameLength = Math.floor((mpeg1 ? 144_000 : 72_000) * bitrateKbps / sampleRateHz) + padding;
    const channelMode = (buffer[index + 3] >> 6) & 0x03;
    const hasCrc = (buffer[index + 1] & 0x01) === 0;
    return { versionBits, bitrateKbps, sampleRateHz, frameLength, channelMode, hasCrc };
  };
  const isRecognizedTrailingMetadata = (index) => {
    let cursor = index;
    while (cursor < buffer.length) {
      const remaining = buffer.length - cursor;
      if (remaining === 128 && buffer.subarray(cursor, cursor + 3).toString("ascii") === "TAG") {
        cursor += 128;
        continue;
      }
      if (remaining >= 10 && buffer.subarray(cursor, cursor + 3).toString("ascii") === "ID3") {
        const size = ((buffer[cursor + 6] & 0x7f) << 21)
          | ((buffer[cursor + 7] & 0x7f) << 14)
          | ((buffer[cursor + 8] & 0x7f) << 7)
          | (buffer[cursor + 9] & 0x7f);
        const footerBytes = (buffer[cursor + 5] & 0x10) !== 0 ? 10 : 0;
        cursor += 10 + size + footerBytes;
        if (cursor > buffer.length) return false;
        continue;
      }
      if (remaining >= 32 && buffer.subarray(cursor, cursor + 8).toString("ascii") === "APETAGEX") {
        const size = buffer.readUInt32LE(cursor + 12);
        if (size < 32) return false;
        cursor += size;
        if (cursor > buffer.length) return false;
        continue;
      }
      return false;
    }
    return cursor === buffer.length;
  };

  const limit = Math.min(buffer.length - 3, offset + 64 * 1024);
  for (let index = offset; index < limit; index++) {
    const first = readHeader(index);
    if (!first || first.frameLength < 24 || index + first.frameLength > buffer.length) continue;
    const crcBytes = first.hasCrc ? 2 : 0;
    const sideInfoBytes = first.versionBits === 3
      ? (first.channelMode === 3 ? 17 : 32)
      : (first.channelMode === 3 ? 9 : 17);
    const xingOffset = index + 4 + crcBytes + sideInfoBytes;
    const vbriOffset = index + 4 + 32;
    const markerAt = (markerOffset, marker) =>
      markerOffset + marker.length <= index + first.frameLength
      && buffer.subarray(markerOffset, markerOffset + marker.length).toString("ascii") === marker;
    if (markerAt(xingOffset, "Xing") || markerAt(vbriOffset, "VBRI")) {
      return {
        codec: "mp3",
        bitrateKbps: first.bitrateKbps,
        sampleRateHz: first.sampleRateHz,
        framesValidated: 0,
        constantBitrate: false,
        vbrHeader: true,
      };
    }

    const headers = [first];
    let frameOffset = index + first.frameLength;
    while (frameOffset < buffer.length && !isRecognizedTrailingMetadata(frameOffset)) {
      const header = readHeader(frameOffset);
      if (
        !header
        || header.versionBits !== first.versionBits
        || header.sampleRateHz !== first.sampleRateHz
        || header.bitrateKbps !== first.bitrateKbps
        || frameOffset + header.frameLength > buffer.length
      ) break;
      headers.push(header);
      frameOffset += header.frameLength;
    }
    const complete = frameOffset === buffer.length || isRecognizedTrailingMetadata(frameOffset);
    if (headers.length >= 3 && complete) {
      return {
        codec: "mp3",
        bitrateKbps: first.bitrateKbps,
        sampleRateHz: first.sampleRateHz,
        framesValidated: headers.length,
        constantBitrate: true,
        vbrHeader: false,
      };
    }
    return {
      codec: "unknown",
      bitrateKbps: null,
      sampleRateHz: null,
      framesValidated: headers.length,
      constantBitrate: false,
      vbrHeader: false,
    };
  }
  return {
    codec: "unknown",
    bitrateKbps: null,
    sampleRateHz: null,
    framesValidated: 0,
    constantBitrate: false,
    vbrHeader: false,
  };
}

/**
 * Compare the source and release audio sets without touching the filesystem.
 * Exported so the release invariant has a focused regression test: every
 * file-backed runtime recording must be one of the manifest-owned Suno MP3s.
 */
export function compareAudioAssetSets({ expected, publicActual, distActual }) {
  const publicMissing = difference(expected, publicActual);
  const publicExtra = difference(publicActual, expected);
  const distMissing = difference(expected, distActual);
  const distExtra = difference(distActual, expected);
  const rootLevelLegacy = [...publicActual]
    .filter((file) => /^audio\/[^/]+\.(?:aac|flac|m4a|mp3|ogg|wav)$/i.test(file))
    .sort();

  return {
    ok: publicMissing.length === 0
      && publicExtra.length === 0
      && distMissing.length === 0
      && distExtra.length === 0
      && rootLevelLegacy.length === 0,
    expectedCount: expected.size,
    public: { missing: publicMissing, extra: publicExtra, rootLevelLegacy },
    dist: { missing: distMissing, extra: distExtra },
  };
}

export function auditAudioAssets(projectRoot = root) {
  const source = readFileSync(join(projectRoot, "src/audio/sunoLibrary.ts"), "utf8");
  const provenance = auditAudioProvenanceSource(source);
  if (!provenance.ok) {
    throw new Error(`Suno provenance manifest is incomplete: ${JSON.stringify(provenance.errors)}`);
  }
  const expected = new Set();
  for (const match of source.matchAll(assetPattern)) {
    expected.add(`audio/${match[1]}/suno/${match[2]}.mp3`);
  }
  if (expected.size !== 40) {
    throw new Error(`Expected 40 unique Suno manifest assets, found ${expected.size}`);
  }

  const publicDirectory = join(projectRoot, "public");
  const distDirectory = join(projectRoot, "dist");
  if (!existsSync(publicDirectory)) throw new Error("public/ is missing; run from the app root");
  if (!existsSync(distDirectory)) throw new Error("dist/ is missing; build before running the audio audit");

  // public/audio is a production source tree, not a local scratch space. Scan
  // every media file there so root-level legacy files and non-Suno subtrees
  // fail before Vite copies them into the release artifact.
  const publicActual = new Set([...mediaFiles(publicDirectory)].filter((file) => file.startsWith("audio/")));
  const distActual = new Set([...mediaFiles(distDirectory)].filter((file) => file.startsWith("audio/")));
  const result = compareAudioAssetSets({ expected, publicActual, distActual });
  if (!result.ok) {
    throw new Error([
      "File-backed runtime audio must match the 40-asset Suno manifest exactly.",
      result.public.missing.length || result.public.extra.length
        ? `public/ managed audio: ${JSON.stringify(result.public)}`
        : "",
      result.dist.missing.length || result.dist.extra.length
        ? `dist/ shipped audio: ${JSON.stringify(result.dist)}`
        : "",
    ].filter(Boolean).join("\n"));
  }
  const encodingErrors = [];
  for (const directory of [publicDirectory, distDirectory]) {
    for (const file of expected) {
      const encoding = inspectMp3EncodingBuffer(readFileSync(join(directory, file)));
      if (
        encoding.codec !== "mp3"
        || encoding.bitrateKbps !== 96
        || encoding.framesValidated < 3
        || !encoding.constantBitrate
        || encoding.vbrHeader
      ) {
        encodingErrors.push(`${relative(projectRoot, join(directory, file))}: ${JSON.stringify(encoding)}`);
      }
    }
  }
  if (encodingErrors.length) {
    throw new Error(`Runtime audio encoding must be MP3 at 96 kbps:\n${encodingErrors.join("\n")}`);
  }
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const result = auditAudioAssets();
  console.log(`Verified exact ${result.expectedCount}-file Suno audio manifest in public/ and dist/.`);
}

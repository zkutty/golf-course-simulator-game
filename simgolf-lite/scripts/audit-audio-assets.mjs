import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

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

export function auditAudioAssets(projectRoot = root) {
  const source = readFileSync(join(projectRoot, "src/audio/sunoLibrary.ts"), "utf8");
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

  // Root-level public/audio files may exist as ignored local quarantine input.
  // Only the two manifest directories are source inputs; the shipped dist set
  // is strict and includes every file-backed media URL.
  const publicActual = new Set(
    [...mediaFiles(publicDirectory)].filter((file) => /^audio\/(?:music|ambience)\//.test(file)),
  );
  const distActual = new Set([...mediaFiles(distDirectory)].filter((file) => file.startsWith("audio/")));
  const publicMissing = difference(expected, publicActual);
  const publicExtra = difference(publicActual, expected);
  const distMissing = difference(expected, distActual);
  const distExtra = difference(distActual, expected);
  const result = {
    ok: publicMissing.length === 0 && publicExtra.length === 0 && distMissing.length === 0 && distExtra.length === 0,
    expectedCount: expected.size,
    public: { missing: publicMissing, extra: publicExtra },
    dist: { missing: distMissing, extra: distExtra },
  };
  if (!result.ok) {
    throw new Error([
      "File-backed audio does not match the 40-asset Suno manifest.",
      publicMissing.length || publicExtra.length
        ? `public/ managed audio: ${JSON.stringify(result.public)}`
        : "",
      distMissing.length || distExtra.length
        ? `dist/ shipped audio: ${JSON.stringify(result.dist)}`
        : "",
    ].filter(Boolean).join("\n"));
  }
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const result = auditAudioAssets();
  console.log(`Verified exact ${result.expectedCount}-file Suno audio manifest in public/ and dist/.`);
}

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourcePath = join(root, "src/audio/sunoLibrary.ts");
const mediaPattern = /\.(?:m4a|mp3|ogg|wav)$/i;
const assetPattern = /asset\(\s*"[^"]+"\s*,\s*"[^"]+"\s*,\s*"[^"]+"\s*,\s*"(music|ambience)"\s*,\s*"([^"]+)"\s*\)/g;
const source = readFileSync(sourcePath, "utf8");
const expected = new Set();

for (const match of source.matchAll(assetPattern)) {
  expected.add(`audio/${match[1]}/suno/${match[2]}.mp3`);
}

if (expected.size !== 40) {
  throw new Error(`Expected 40 unique Suno manifest assets, found ${expected.size}`);
}

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

for (const name of ["public", "dist"]) {
  const directory = join(root, name);
  if (!existsSync(directory)) throw new Error(`${name}/ is missing; build before running the audio audit`);
  const actual = mediaFiles(directory);
  const missing = difference(expected, actual);
  const extra = difference(actual, expected);
  if (missing.length || extra.length) {
    throw new Error([
      `${name}/ audio does not match the Suno manifest.`,
      missing.length ? `Missing: ${missing.join(", ")}` : "",
      extra.length ? `Unexpected: ${extra.join(", ")}` : "",
    ].filter(Boolean).join("\n"));
  }
}

console.log("Verified exact 40-file Suno audio manifest in public/ and dist/.");

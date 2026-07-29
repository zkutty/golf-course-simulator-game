import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { PNG } from "pngjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PIPELINE_ROOT = path.join(ROOT, "art/pixellab");
const STAGING_ROOT = path.join(PIPELINE_ROOT, "staging");
const MANIFEST_PATH = path.join(PIPELINE_ROOT, "manifest.json");
const BENCHMARK_PATH = path.join(PIPELINE_ROOT, "benchmark.json");
const DOC_PATH = path.join(ROOT, "docs/PIXELLAB_ART_PIPELINE.md");
const PINNED_REMOTE = "mcp-remote@0.1.38";

const STATES = new Set([
  "planned",
  "raw",
  "candidate",
  "cleaned",
  "approved",
  "rejected",
  "reference",
  "production",
]);
const FILE_STATES = new Set([
  "raw",
  "candidate",
  "cleaned",
  "approved",
  "reference",
  "production",
]);
const APPROVED_STATES = new Set(["approved", "reference", "production"]);
const STAGED_STATES = new Set(["raw", "candidate", "cleaned", "approved"]);
const PROMOTION_TRANSITIONS = new Map([
  ["planned", new Set(["planned", "raw", "candidate", "rejected"])],
  ["raw", new Set(["candidate", "rejected"])],
  ["candidate", new Set(["cleaned", "rejected"])],
  ["cleaned", new Set(["approved", "rejected"])],
  ["approved", new Set(["production", "rejected"])],
  ["rejected", new Set(["candidate", "rejected"])],
  ["production", new Set(["production"])],
  ["reference", new Set(["reference"])],
]);
const PNG_FILENAME = /^[a-z0-9][a-z0-9._-]*\.png$/;
const GRID_FILENAME = /\.grid(\d+)x(\d+)\.png$/;
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:sk|ghp|github_pat|xox[baprs])-[-_A-Za-z0-9]{16,}\b/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bBearer\s+(?!<|\$\{|replace-)[A-Za-z0-9._~+/-]{20,}/i,
  /\b(?:authorization|auth(?:entication)?[-_ ]?header|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|secret)\s*[:=]\s*["']?(?:Bearer\s+)?[A-Za-z0-9._~+/-]{16,}/i,
];

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function bottomPadding(png) {
  for (let y = png.height - 1; y >= 0; y -= 1) {
    for (let x = 0; x < png.width; x += 1) {
      if (png.data[(y * png.width + x) * 4 + 3] > 8) {
        return png.height - 1 - y;
      }
    }
  }
  return png.height;
}

function transparencyStats(png) {
  let transparent = 0;
  let opaque = 0;
  for (let index = 3; index < png.data.length; index += 4) {
    if (png.data[index] === 0) transparent += 1;
    if (png.data[index] > 8) opaque += 1;
  }
  return { transparent, opaque };
}

function alphaBounds(png) {
  let minX = png.width;
  let minY = png.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      if (png.data[(y * png.width + x) * 4 + 3] <= 8) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < minX ? null : { minX, minY, maxX, maxY };
}

function alphaMetrics(png) {
  const bounds = alphaBounds(png);
  let transparent = 0;
  let visible = 0;
  let partial = 0;
  let min = 255;
  let max = 0;
  for (let index = 3; index < png.data.length; index += 4) {
    const alpha = png.data[index];
    min = Math.min(min, alpha);
    max = Math.max(max, alpha);
    if (alpha === 0) transparent += 1;
    if (alpha > 8) visible += 1;
    if (alpha > 0 && alpha < 255) partial += 1;
  }
  const padding = bounds
    ? {
      top: bounds.minY,
      right: png.width - 1 - bounds.maxX,
      bottom: png.height - 1 - bounds.maxY,
      left: bounds.minX,
    }
    : { top: png.height, right: png.width, bottom: png.height, left: png.width };
  return { bounds, transparent, visible, partial, min, max, padding };
}

function resolveProjectFile(reference) {
  if (typeof reference !== "string" || !reference || reference.includes("#")) return null;
  const normalized = reference.replaceAll("\\", "/");
  if (path.isAbsolute(normalized) || normalized.includes("..")) return null;
  const file = path.resolve(ROOT, normalized);
  return inside(ROOT, file) && existsSync(file) && statSync(file).isFile() ? file : null;
}

function sourceFileFor(asset) {
  return (asset.sourceReferences ?? [])
    .map(resolveProjectFile)
    .find((file) => file && /\.png$/i.test(file)) ?? null;
}

export function measureAsset(asset) {
  if (!asset?.file) return null;
  const file = resolveProjectFile(asset.file);
  if (!file) return null;
  const png = PNG.sync.read(readFileSync(file));
  const source = sourceFileFor(asset);
  let sourcePayloadBytes = null;
  let sourceTextureMemoryBytes = null;
  let sourceSha256 = null;
  if (source) {
    const sourcePng = PNG.sync.read(readFileSync(source));
    sourcePayloadBytes = statSync(source).size;
    sourceTextureMemoryBytes = sourcePng.width * sourcePng.height * 4;
    sourceSha256 = sha256(source);
  }
  const payloadBytes = statSync(file).size;
  const textureMemoryBytes = png.width * png.height * 4;
  return {
    payloadBytes,
    textureMemoryBytes,
    sourcePayloadBytes,
    sourceTextureMemoryBytes,
    payloadDeltaBytes: sourcePayloadBytes === null ? null : payloadBytes - sourcePayloadBytes,
    textureMemoryDeltaBytes: sourceTextureMemoryBytes === null
      ? null
      : textureMemoryBytes - sourceTextureMemoryBytes,
    sourceSha256,
  };
}

export function validatePromotionPath(asset) {
  const errors = [];
  const pathStates = asset?.promotionPath;
  if (!Array.isArray(pathStates) || pathStates.length === 0) {
    return [`${asset?.id ?? "<missing>"}: promotionPath is required`];
  }
  if (pathStates.at(-1) !== asset.state) {
    errors.push(`${asset.id}: promotionPath must end at state ${asset.state}`);
  }
  for (let index = 1; index < pathStates.length; index += 1) {
    const previous = pathStates[index - 1];
    const next = pathStates[index];
    if (!PROMOTION_TRANSITIONS.get(previous)?.has(next)) {
      errors.push(`${asset.id}: invalid promotion ${previous} -> ${next}`);
    }
  }
  return errors;
}

function validateAtlasMetadata(sheet, label) {
  const errors = [];
  const width = sheet?.meta?.size?.w;
  const height = sheet?.meta?.size?.h;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return [`${label}: atlas dimensions are invalid`];
  }
  if (typeof sheet.meta.image !== "string" || !PNG_FILENAME.test(sheet.meta.image)) {
    errors.push(`${label}: atlas image filename is invalid`);
  }
  const frames = sheet.frames ?? {};
  for (const [name, entry] of Object.entries(frames)) {
    const frame = entry?.frame;
    if (!/^[a-z0-9_]+$/.test(name)) errors.push(`${label}: invalid frame name ${name}`);
    if (!frame || ![frame.x, frame.y, frame.w, frame.h].every(Number.isInteger)
      || frame.w <= 0 || frame.h <= 0 || frame.x < 0 || frame.y < 0
      || frame.x + frame.w > width || frame.y + frame.h > height) {
      errors.push(`${label}: frame ${name} is outside atlas bounds`);
      continue;
    }
    if (entry.rotated !== false || entry.trimmed !== false) {
      errors.push(`${label}: frame ${name} must not be rotated or trimmed`);
    }
    if (entry.sourceSize?.w !== frame.w || entry.sourceSize?.h !== frame.h) {
      errors.push(`${label}: frame ${name} sourceSize does not match frame`);
    }
  }
  const rectangles = Object.entries(frames)
    .map(([name, entry]) => ({ name, frame: entry?.frame }))
    .filter(({ frame }) => frame && [frame.x, frame.y, frame.w, frame.h].every(Number.isInteger))
    .map(({ name, frame }) => ({ name, ...frame }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const active = [];
  for (const frame of rectangles) {
    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (active[index].y + active[index].h <= frame.y) active.splice(index, 1);
    }
    for (const other of active) {
      if (other.x < frame.x + frame.w && frame.x < other.x + other.w) {
        errors.push(`${label}: frames ${other.name} and ${frame.name} overlap`);
      }
    }
    active.push(frame);
  }
  return errors;
}

export function normalizeCandidate({ input, output, width, height, padding = 4 }) {
  const source = PNG.sync.read(readFileSync(input));
  const bounds = alphaBounds(source);
  if (!bounds) throw new Error("candidate has no visible pixels");
  const cropWidth = bounds.maxX - bounds.minX + 1;
  const cropHeight = bounds.maxY - bounds.minY + 1;
  const scale = Math.min((width - padding * 2) / cropWidth, (height - padding * 2) / cropHeight);
  if (!(scale > 0)) throw new Error("candidate target canvas is too small");
  const drawWidth = Math.max(1, Math.round(cropWidth * scale));
  const drawHeight = Math.max(1, Math.round(cropHeight * scale));
  const offsetX = Math.floor((width - drawWidth) / 2);
  const offsetY = height - padding - drawHeight;
  const result = new PNG({ width, height });

  for (let y = 0; y < drawHeight; y += 1) {
    for (let x = 0; x < drawWidth; x += 1) {
      const sourceX = bounds.minX + (x + 0.5) / scale - 0.5;
      const sourceY = bounds.minY + (y + 0.5) / scale - 0.5;
      const x0 = Math.max(bounds.minX, Math.min(bounds.maxX, Math.floor(sourceX)));
      const y0 = Math.max(bounds.minY, Math.min(bounds.maxY, Math.floor(sourceY)));
      const x1 = Math.min(bounds.maxX, x0 + 1);
      const y1 = Math.min(bounds.maxY, y0 + 1);
      const tx = Math.max(0, Math.min(1, sourceX - Math.floor(sourceX)));
      const ty = Math.max(0, Math.min(1, sourceY - Math.floor(sourceY)));
      const samples = [
        [x0, y0, (1 - tx) * (1 - ty)],
        [x1, y0, tx * (1 - ty)],
        [x0, y1, (1 - tx) * ty],
        [x1, y1, tx * ty],
      ];
      let alpha = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (const [sampleX, sampleY, weight] of samples) {
        const sourceIndex = (sampleY * source.width + sampleX) * 4;
        const sampleAlpha = source.data[sourceIndex + 3] / 255;
        const premultipliedWeight = weight * sampleAlpha;
        alpha += premultipliedWeight;
        red += source.data[sourceIndex] * premultipliedWeight;
        green += source.data[sourceIndex + 1] * premultipliedWeight;
        blue += source.data[sourceIndex + 2] * premultipliedWeight;
      }
      const destination = ((offsetY + y) * width + offsetX + x) * 4;
      result.data[destination + 3] = Math.round(alpha * 255);
      if (alpha > 0) {
        result.data[destination] = Math.round(red / alpha);
        result.data[destination + 1] = Math.round(green / alpha);
        result.data[destination + 2] = Math.round(blue / alpha);
      }
    }
  }

  writeFileSync(output, PNG.sync.write(result));
  return {
    input: path.relative(ROOT, input),
    output: path.relative(ROOT, output),
    source: { width: source.width, height: source.height },
    target: { width, height },
    draw: { width: drawWidth, height: drawHeight, offsetX, offsetY },
    sha256: sha256(output),
  };
}

export function buildPreviewAtlas({ candidate, frame, output }) {
  if (!/^[a-z0-9_]+$/.test(frame)) throw new Error("preview frame name is invalid");
  const candidatePath = path.resolve(candidate);
  const outputPath = path.resolve(output);
  if (!inside(ROOT, candidatePath) || !inside(ROOT, outputPath)) {
    throw new Error("preview candidate and output must stay inside the project");
  }
  if (!existsSync(candidatePath) || path.extname(candidatePath).toLowerCase() !== ".png") {
    throw new Error("preview candidate must be an existing PNG");
  }
  const source = path.join(outputPath, "_building-source");
  rmSync(outputPath, { recursive: true, force: true });
  mkdirSync(source, { recursive: true });
  const productionSource = path.join(ROOT, "src/assets/sprites");
  for (const entry of readdirSync(productionSource, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".png")) continue;
    copyFileSync(path.join(productionSource, entry.name), path.join(source, entry.name));
  }
  copyFileSync(candidatePath, path.join(source, `${frame}.png`));
  const run = spawnSync(process.execPath, ["scripts/build-atlas.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      COURSECRAFT_ATLAS_OUT_DIR: outputPath,
      COURSECRAFT_BUILDING_SOURCE_DIR: source,
    },
    encoding: "utf8",
  });
  rmSync(source, { recursive: true, force: true });
  if (run.status !== 0) throw new Error(run.stderr || run.stdout || "preview atlas build failed");
  const metadata = readJson(path.join(outputPath, "buildings-decor.json"));
  if (!metadata.frames?.[frame]) throw new Error(`preview atlas is missing ${frame}`);
  return {
    frame,
    output: path.relative(ROOT, outputPath),
    pngSha256: sha256(path.join(outputPath, "buildings-decor.png")),
    frameCount: Object.keys(metadata.frames).length,
  };
}

function listTextFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "staging") continue;
      files.push(...listTextFiles(full));
    } else if (/\.(?:json|md|mjs|js|ts|tsx|jsx|toml|txt)$/i.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

export function doctor({ requireAuth = false } = {}) {
  const errors = [];
  const warnings = [];
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isInteger(major) || major < 18) {
    errors.push(`Node 18+ required; found ${process.versions.node}`);
  }
  const npx = spawnSync("npx", ["--version"], { encoding: "utf8" });
  if (npx.status !== 0) errors.push("npx is unavailable");

  const docs = readFileSync(DOC_PATH, "utf8");
  if (!docs.includes(PINNED_REMOTE)) errors.push(`documentation must pin ${PINNED_REMOTE}`);
  if (docs.includes("mcp-remote@latest")) errors.push("unreviewed mcp-remote@latest is prohibited");

  if (!inside(ROOT, STAGING_ROOT)) errors.push("staging path escapes the project root");
  const auth = process.env.PIXELLAB_AUTH_HEADER?.trim() ?? "";
  const authPresent = auth.length > 0;
  const authValid = /^Bearer [^\s]{20,}$/.test(auth);
  if (authPresent && !authValid) errors.push("PIXELLAB_AUTH_HEADER is present but malformed");
  if (!authPresent) warnings.push("rotated PixelLab credential is not connected");
  if (requireAuth && !authPresent) errors.push("PIXELLAB_AUTH_HEADER is required for live generation");

  return {
    ok: errors.length === 0,
    node: process.versions.node,
    npx: npx.status === 0,
    bridge: PINNED_REMOTE,
    staging: path.relative(ROOT, STAGING_ROOT),
    auth: authPresent ? (authValid ? "present-valid-shape" : "present-invalid-shape") : "missing",
    errors,
    warnings,
  };
}

export function validateManifest({ requirePilotApproval = false } = {}) {
  const errors = [];
  const warnings = [];
  const manifest = readJson(MANIFEST_PATH);
  if (manifest.version !== 1 || manifest.pipeline !== "pixellab-pilot") {
    errors.push("manifest version/pipeline is unsupported");
  }
  if (manifest.policy?.runtimeGeneration !== false) errors.push("runtime generation must be false");
  if (manifest.policy?.promotionRequiresReview !== true) errors.push("promotion must require review");
  if (manifest.policy?.secretsAllowed !== false) errors.push("manifest secretsAllowed must be false");

  const ids = new Set();
  const files = new Map();
  const hashes = new Map();
  const measurements = {};
  let lastId = "";
  for (const asset of manifest.assets ?? []) {
    if (!asset.id || ids.has(asset.id)) errors.push(`duplicate or missing asset id: ${asset.id ?? "<missing>"}`);
    ids.add(asset.id);
    if (lastId && asset.id.localeCompare(lastId) < 0) errors.push(`assets must be sorted by id: ${asset.id}`);
    lastId = asset.id;
    if (!STATES.has(asset.state)) errors.push(`${asset.id}: invalid state ${asset.state}`);
    if (asset.promotionPath) errors.push(...validatePromotionPath(asset));
    if ((asset.state === "approved" || asset.state === "production") && !asset.promotionPath) {
      errors.push(`${asset.id}: ${asset.state} state requires promotionPath`);
    }
    if (asset.review?.decision === "approved" && !asset.review?.reviewer) {
      errors.push(`${asset.id}: approved review requires a reviewer`);
    }
    if (APPROVED_STATES.has(asset.state) && asset.review?.decision !== "approved") {
      errors.push(`${asset.id}: ${asset.state} state requires an approved review`);
    }
    if (asset.state === "rejected" && asset.review?.decision === "approved") {
      errors.push(`${asset.id}: rejected state cannot have an approved review`);
    }
    if (!asset.promptRef) errors.push(`${asset.id}: promptRef is required`);
    if (!asset.licenseNotes) errors.push(`${asset.id}: licenseNotes is required`);
    if (!asset.provider) errors.push(`${asset.id}: provider is required`);
    if (!asset.tool && !asset.model && !asset.endpoint) {
      warnings.push(`${asset.id}: provenance tool/model/endpoint is incomplete`);
    }
    if (!asset.requirements || asset.requirements.transparent !== true) {
      errors.push(`${asset.id}: transparent PNG requirement is mandatory`);
    }
    if (asset.requirements?.anchor?.[0] !== 0.5 || asset.requirements?.anchor?.[1] !== 1) {
      errors.push(`${asset.id}: bottom-center [0.5,1] anchor is mandatory`);
    }
    if (asset.sourceHashes && (typeof asset.sourceHashes !== "object" || Array.isArray(asset.sourceHashes))) {
      errors.push(`${asset.id}: sourceHashes must be an object keyed by source reference`);
    }

    if (!FILE_STATES.has(asset.state)) continue;
    if (!asset.file || !asset.sha256) {
      errors.push(`${asset.id}: ${asset.state} assets require file and sha256`);
      continue;
    }
    const normalizedFile = asset.file.replaceAll("\\", "/");
    if (path.isAbsolute(asset.file) || normalizedFile !== asset.file || asset.file.includes("..")) {
      errors.push(`${asset.id}: file must be a relative project path`);
    }
    const file = path.resolve(ROOT, asset.file);
    const isStaged = inside(STAGING_ROOT, file);
    if (STAGED_STATES.has(asset.state) && !isStaged) {
      errors.push(`${asset.id}: staged state points outside staging`);
    }
    if (asset.state === "production" && (isStaged || !inside(path.join(ROOT, "src/assets"), file))) {
      errors.push(`${asset.id}: production state must point to src/assets outside staging`);
    }
    if (!PNG_FILENAME.test(path.basename(asset.file))) {
      errors.push(`${asset.id}: filename must be lowercase kebab/snake/dot PNG syntax`);
    }
    if (files.has(normalizedFile)) {
      errors.push(`${asset.id}: filename collides with ${files.get(normalizedFile)}`);
    } else {
      files.set(normalizedFile, asset.id);
    }
    if (!existsSync(file)) {
      errors.push(`${asset.id}: missing file ${asset.file}`);
      continue;
    }
    if (statSync(file).isDirectory() || path.extname(file).toLowerCase() !== ".png") {
      errors.push(`${asset.id}: file must be a PNG`);
      continue;
    }
    if (sha256(file) !== asset.sha256) errors.push(`${asset.id}: sha256 mismatch`);
    let png;
    try {
      png = PNG.sync.read(readFileSync(file));
    } catch {
      errors.push(`${asset.id}: invalid PNG`);
      continue;
    }
    if (png.width !== asset.requirements.width || png.height !== asset.requirements.height) {
      errors.push(`${asset.id}: expected ${asset.requirements.width}x${asset.requirements.height}, found ${png.width}x${png.height}`);
    }
    const alpha = alphaMetrics(png);
    if (alpha.transparent === 0 || alpha.visible === 0) {
      errors.push(`${asset.id}: PNG must contain both transparent and visible pixels`);
    }
    if (alpha.min < 0 || alpha.max > 255) {
      errors.push(`${asset.id}: alpha values exceed 0-255 bounds`);
    }
    const alphaRequirement = asset.requirements.alpha;
    if (alphaRequirement?.min !== undefined && alpha.min < alphaRequirement.min) {
      errors.push(`${asset.id}: alpha minimum ${alpha.min} is below ${alphaRequirement.min}`);
    }
    if (alphaRequirement?.max !== undefined && alpha.max > alphaRequirement.max) {
      errors.push(`${asset.id}: alpha maximum ${alpha.max} exceeds ${alphaRequirement.max}`);
    }
    if (alphaRequirement?.maxPartialPixels !== undefined && alpha.partial > alphaRequirement.maxPartialPixels) {
      errors.push(`${asset.id}: partial alpha count ${alpha.partial} exceeds ${alphaRequirement.maxPartialPixels}`);
    }
    if (alpha.padding.bottom > (asset.requirements.bottomPaddingMax ?? 8)) {
      errors.push(`${asset.id}: bottom padding ${alpha.padding.bottom}px exceeds anchor tolerance`);
    }
    const anchorTolerance = asset.requirements.anchorTolerancePixels ?? 1;
    if (Math.abs(alpha.padding.left - alpha.padding.right) > anchorTolerance) {
      errors.push(`${asset.id}: visible bounds are not centered on the declared anchor`);
    }
    if (asset.requirements.paddingMax) {
      for (const side of ["top", "right", "bottom", "left"]) {
        const limit = asset.requirements.paddingMax[side];
        if (limit !== undefined && alpha.padding[side] > limit) {
          errors.push(`${asset.id}: ${side} transparent padding ${alpha.padding[side]}px exceeds ${limit}px`);
        }
      }
    }
    const grid = asset.requirements.grid;
    if (grid) {
      if (png.width !== grid.columns * grid.frameWidth || png.height !== grid.rows * grid.frameHeight) {
        errors.push(`${asset.id}: grid dimensions do not match canvas`);
      }
      const match = GRID_FILENAME.exec(path.basename(asset.file));
      if (match && (Number(match[1]) !== grid.columns || Number(match[2]) !== grid.rows)) {
        errors.push(`${asset.id}: filename grid suffix does not match manifest grid`);
      }
    }
    const hash = sha256(file);
    if (hashes.has(hash)) errors.push(`${asset.id}: duplicate PNG content with ${hashes.get(hash)}`);
    else hashes.set(hash, asset.id);
    const measurement = measureAsset(asset);
    if (measurement) {
      measurements[asset.id] = measurement;
      if (asset.measurements) {
        for (const key of ["payloadBytes", "textureMemoryBytes", "payloadDeltaBytes", "textureMemoryDeltaBytes"]) {
          if (asset.measurements[key] !== measurement[key]) {
            errors.push(`${asset.id}: recorded ${key} does not match file measurement`);
          }
        }
      } else if (STAGED_STATES.has(asset.state)) {
        warnings.push(`${asset.id}: staged asset has no recorded payload/memory measurements`);
      }
    }
    for (const sourceReference of asset.sourceReferences ?? []) {
      const source = resolveProjectFile(sourceReference);
      if (!source) continue;
      const sourceHash = sha256(source);
      if (asset.sourceHashes?.[sourceReference] && asset.sourceHashes[sourceReference] !== sourceHash) {
        errors.push(`${asset.id}: source hash mismatch for ${sourceReference}`);
      }
    }
  }

  for (const file of listTextFiles(PIPELINE_ROOT)) {
    const text = readFileSync(file, "utf8");
    if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) {
      errors.push(`${path.relative(ROOT, file)}: possible bearer credential`);
    }
    if (/mcp-remote@latest/.test(text)) errors.push(`${path.relative(ROOT, file)}: unpinned mcp-remote`);
  }

  for (const directory of ["src", "worker", "public"]) {
    const runtimeRoot = path.join(ROOT, directory);
    if (!existsSync(runtimeRoot)) continue;
    for (const file of listTextFiles(runtimeRoot)) {
      const text = readFileSync(file, "utf8");
      if (/pixellab|PIXELLAB_AUTH_HEADER|api\.pixellab\.ai/i.test(text)) {
        errors.push(`${path.relative(ROOT, file)}: runtime must not reference PixelLab`);
      }
    }
  }

  const approvedPixelLab = (manifest.assets ?? []).filter(
    (asset) => asset.provider === "pixellab" && asset.state === "approved"
  );
  const approvedStatic = approvedPixelLab.some((asset) => asset.category !== "golfer-animation");
  const approvedAnimated = approvedPixelLab.some((asset) => asset.category === "golfer-animation");
  if (!approvedStatic) warnings.push("no approved PixelLab static candidate");
  if (!approvedAnimated) warnings.push("no approved PixelLab animation candidate");
  if (requirePilotApproval && (!approvedStatic || !approvedAnimated)) {
    errors.push("certification requires approved PixelLab static and animated candidates");
  }

  return {
    ok: errors.length === 0,
    assets: manifest.assets?.length ?? 0,
    approvedPixelLab: approvedPixelLab.length,
    measurements,
    errors,
    warnings,
  };
}

export function verifyAtlasDeterminism() {
  const first = mkdtempSync(path.join(tmpdir(), "coursecraft-atlas-a-"));
  const second = mkdtempSync(path.join(tmpdir(), "coursecraft-atlas-b-"));
  try {
    for (const output of [first, second]) {
      const run = spawnSync(process.execPath, ["scripts/build-atlas.mjs"], {
        cwd: ROOT,
        env: { ...process.env, COURSECRAFT_ATLAS_OUT_DIR: output },
        encoding: "utf8",
      });
      if (run.status !== 0) {
        return { ok: false, errors: [`isolated atlas build failed: ${run.stderr || run.stdout}`] };
      }
    }
    const names = [
      "terrain.png",
      "terrain.json",
      "natural-props.png",
      "natural-props.json",
      "buildings-decor.png",
      "buildings-decor.json",
      "golfers.png",
      "golfers.json",
    ];
    const errors = [];
    const atlasReports = {};
    for (const name of names) {
      const a = path.join(first, name);
      const b = path.join(second, name);
      if (!existsSync(a) || !existsSync(b)) {
        errors.push(`${name}: missing isolated rebuild output`);
      } else if (sha256(a) !== sha256(b)) {
        errors.push(`${name}: repeated isolated rebuild is not byte-stable`);
      }
      if (name.endsWith(".json")) {
        let sheet;
        try {
          sheet = readJson(a);
          errors.push(...validateAtlasMetadata(sheet, name));
        } catch (error) {
          errors.push(`${name}: invalid atlas metadata (${error.message})`);
          continue;
        }
        const production = path.join(ROOT, "public/atlases", name);
        if (!existsSync(production)) {
          errors.push(`${name}: checked-in atlas metadata is missing`);
          continue;
        }
        const expectedFrames = Object.keys(readJson(production).frames ?? {}).sort();
        const rebuiltFrames = Object.keys(sheet.frames ?? {}).sort();
        if (JSON.stringify(expectedFrames) !== JSON.stringify(rebuiltFrames)) {
          errors.push(`${name}: checked-in and rebuilt frame registries differ`);
        }
        const imagePath = path.join(first, sheet.meta.image);
        atlasReports[name] = {
          frames: rebuiltFrames.length,
          payloadBytes: statSync(a).size + (existsSync(imagePath) ? statSync(imagePath).size : 0),
          textureMemoryBytes: sheet.meta.size.w * sheet.meta.size.h * 4,
        };
      }
    }
    return { ok: errors.length === 0, files: names.length, atlasReports, errors };
  } finally {
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
  }
}

export function validateBenchmark({ requireComplete = false } = {}) {
  const benchmark = readJson(BENCHMARK_PATH);
  const errors = [];
  const weights = (benchmark.criteria ?? []).reduce((sum, criterion) => sum + criterion.weight, 0);
  if (weights !== 100) errors.push(`benchmark weights must total 100, found ${weights}`);
  const providers = new Set((benchmark.providers ?? []).map((provider) => provider.id));
  for (const required of [
    "pixellab",
    "layer-or-scenario",
    "high-resolution-image-generator",
    "coursecraft-procedural-manual",
  ]) {
    if (!providers.has(required)) errors.push(`benchmark missing provider ${required}`);
  }
  for (const provider of benchmark.providers ?? []) {
    if (!provider.evidence) continue;
    const evidence = path.resolve(ROOT, provider.evidence.file);
    if (!inside(ROOT, evidence) || !existsSync(evidence)) {
      errors.push(`${provider.id}: benchmark evidence is missing or outside the project`);
      continue;
    }
    if (sha256(evidence) !== provider.evidence.sha256) {
      errors.push(`${provider.id}: benchmark evidence sha256 mismatch`);
    }
    try {
      const png = PNG.sync.read(readFileSync(evidence));
      if (png.width !== provider.evidence.width || png.height !== provider.evidence.height) {
        errors.push(`${provider.id}: benchmark evidence dimensions mismatch`);
      }
    } catch {
      errors.push(`${provider.id}: benchmark evidence is not a valid PNG`);
    }
  }
  if (requireComplete && benchmark.status !== "complete") {
    errors.push("certification requires benchmark status complete");
  }
  if (requireComplete) {
    for (const provider of benchmark.providers ?? []) {
      for (const criterion of benchmark.criteria ?? []) {
        const value = provider.scores?.[criterion.id];
        if (!Number.isFinite(value) || value < 1 || value > 5) {
          errors.push(`${provider.id}: missing 1-5 score for ${criterion.id}`);
        }
      }
      for (const measurement of benchmark.requiredMeasurements ?? []) {
        if (!(measurement in (provider.measurements ?? {}))) {
          errors.push(`${provider.id}: missing measurement ${measurement}`);
        }
      }
    }
  }
  return { ok: errors.length === 0, status: benchmark.status, weights, errors };
}

function printResult(name, result) {
  process.stdout.write(`${JSON.stringify({ check: name, ...result }, null, 2)}\n`);
}

function main() {
  const command = process.argv[2] ?? "validate";
  if (command === "doctor") {
    const result = doctor({ requireAuth: process.argv.includes("--require-auth") });
    printResult("doctor", result);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }
  if (command === "validate") {
    const manifest = validateManifest();
    const benchmark = validateBenchmark();
    printResult("manifest", manifest);
    printResult("benchmark", benchmark);
    process.exitCode = manifest.ok && benchmark.ok ? 0 : 1;
    return;
  }
  if (command === "certify") {
    const health = doctor({ requireAuth: true });
    const manifest = validateManifest({ requirePilotApproval: true });
    const benchmark = validateBenchmark({ requireComplete: true });
    const atlases = verifyAtlasDeterminism();
    printResult("doctor", health);
    printResult("manifest", manifest);
    printResult("benchmark", benchmark);
    printResult("atlas-determinism", atlases);
    process.exitCode = health.ok && manifest.ok && benchmark.ok && atlases.ok ? 0 : 1;
    return;
  }
  if (command === "normalize") {
    const value = (flag) => {
      const index = process.argv.indexOf(flag);
      return index >= 0 ? process.argv[index + 1] : undefined;
    };
    const input = value("--input");
    const output = value("--output");
    const width = Number(value("--width"));
    const height = Number(value("--height"));
    const padding = Number(value("--padding") ?? 4);
    if (!input || !output || !Number.isInteger(width) || !Number.isInteger(height)) {
      throw new Error("normalize requires --input, --output, --width, and --height");
    }
    const result = normalizeCandidate({
      input: path.resolve(ROOT, input),
      output: path.resolve(ROOT, output),
      width,
      height,
      padding,
    });
    printResult("normalize", { ok: true, ...result });
    return;
  }
  if (command === "preview-atlas") {
    const value = (flag) => {
      const index = process.argv.indexOf(flag);
      return index >= 0 ? process.argv[index + 1] : undefined;
    };
    const candidate = value("--candidate");
    const frame = value("--frame");
    const output = value("--output");
    if (!candidate || !frame || !output) {
      throw new Error("preview-atlas requires --candidate, --frame, and --output");
    }
    const result = buildPreviewAtlas({
      candidate: path.resolve(ROOT, candidate),
      frame,
      output: path.resolve(ROOT, output),
    });
    printResult("preview-atlas", { ok: true, ...result });
    return;
  }
  process.stderr.write(`Unknown command: ${command}\n`);
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

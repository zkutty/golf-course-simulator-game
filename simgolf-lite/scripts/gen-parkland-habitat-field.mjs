// Deterministic, source-only Parkland habitat-field vocabulary for ZK-472-A1.
// It intentionally has no runtime imports or gameplay authority.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = path.join(ROOT, "src/assets/terrain/parkland-habitat-4x");
const OUTPUT = path.resolve(process.env.COURSECRAFT_HABITAT_OUTPUT_DIR || DEFAULT_OUTPUT);
const CONTRACT = "src/assets/terrain/contracts/parkland-habitat-field-v1.json";
const GENERATOR = "scripts/gen-parkland-habitat-field.mjs";
const FAMILIES = [
  "woodland_floor", "understory_edge", "meadow_deep_rough_margin", "wet_shore", "rock_leaf_transition",
];
const DENSE_MASK_FAMILIES = new Set(["woodland_floor", "understory_edge"]);
const CANONICAL_MASKS = [0, 1, 5, 7, 17, 21, 23, 31, 85, 87, 95, 119, 127, 255];
const MASK_BITS = { n: 1, ne: 2, e: 4, se: 8, s: 16, sw: 32, w: 64, nw: 128 };
const MASK_OFFSETS = {
  n: { x: 0, y: -1 }, ne: { x: 1, y: -1 }, e: { x: 1, y: 0 }, se: { x: 1, y: 1 },
  s: { x: 0, y: 1 }, sw: { x: -1, y: 1 }, w: { x: -1, y: 0 }, nw: { x: -1, y: -1 },
};
const D4_TRANSFORMS = [
  "identity", "rotate90", "rotate180", "rotate270",
  "reflectX", "reflectXRotate90", "reflectXRotate180", "reflectXRotate270",
];
const TIERS = {
  high: { scale: 4, width: 256, height: 128, gutter: 4, detail: 3 },
  medium: { scale: 2, width: 128, height: 64, gutter: 2, detail: 2 },
  low: { scale: 1, width: 64, height: 32, gutter: 1, detail: 1 },
};
const FAMILY = {
  woodland_floor: { pattern: "leaf-litter-braids", colors: [[83, 77, 41], [114, 101, 52], [54, 82, 43], [144, 119, 59]] },
  understory_edge: { pattern: "fern-frond-zigzags", colors: [[42, 92, 49], [64, 119, 55], [94, 128, 57], [35, 72, 43]] },
  meadow_deep_rough_margin: { pattern: "broken-grass-fans", colors: [[93, 124, 48], [126, 145, 61], [166, 157, 72], [64, 103, 47]] },
  wet_shore: { pattern: "reed-and-dark-silt-forks", colors: [[43, 91, 69], [63, 119, 83], [100, 133, 75], [50, 72, 60]] },
  rock_leaf_transition: { pattern: "angular-stone-leaf-mosaic", colors: [[91, 91, 72], [122, 117, 89], [69, 79, 62], [142, 124, 73]] },
};
const MODE_TARGETS = {
  standard: Object.fromEntries(FAMILIES.map((family) => [family, FAMILY[family].colors])),
  deuteranopia: {
    woodland_floor: [[78, 72, 58], [132, 98, 50], [55, 65, 78], [184, 140, 69]],
    understory_edge: [[32, 82, 126], [52, 125, 175], [84, 160, 203], [26, 63, 96]],
    meadow_deep_rough_margin: [[120, 103, 31], [171, 144, 47], [219, 188, 81], [88, 77, 31]],
    wet_shore: [[25, 77, 83], [38, 110, 122], [72, 146, 153], [29, 57, 66]],
    rock_leaf_transition: [[91, 82, 106], [130, 113, 146], [67, 66, 86], [163, 129, 126]],
  },
  protanopia: {
    woodland_floor: [[73, 72, 64], [125, 101, 57], [52, 66, 80], [178, 143, 75]],
    understory_edge: [[27, 80, 129], [46, 124, 179], [77, 159, 205], [22, 62, 98]],
    meadow_deep_rough_margin: [[115, 106, 35], [166, 148, 52], [214, 191, 86], [84, 79, 34]],
    wet_shore: [[21, 75, 86], [34, 109, 126], [67, 145, 157], [25, 56, 69]],
    rock_leaf_transition: [[87, 83, 110], [126, 115, 150], [64, 67, 90], [158, 132, 132]],
  },
  tritanopia: {
    woodland_floor: [[93, 67, 74], [144, 96, 91], [66, 61, 74], [184, 126, 105]],
    understory_edge: [[37, 91, 58], [56, 130, 75], [91, 158, 91], [31, 69, 49]],
    meadow_deep_rough_margin: [[112, 103, 66], [157, 140, 78], [200, 179, 101], [82, 77, 52]],
    wet_shore: [[31, 83, 68], [45, 116, 85], [78, 149, 103], [34, 62, 57]],
    rock_leaf_transition: [[96, 82, 91], [134, 113, 119], [71, 67, 77], [165, 129, 111]],
  },
};
const PALETTE_TRANSFORMS = Object.fromEntries(Object.entries(MODE_TARGETS).map(([mode, families]) => [
  mode,
  Object.fromEntries(FAMILIES.map((family) => [family, {
    patternId: FAMILY[family].pattern,
    mappings: FAMILY[family].colors.map((from, index) => ({ from, to: families[family][index] })),
  }])),
]));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const offset = (image, x, y) => (y * image.width + x) * 4;

function assertSafeOutput(target) {
  const parts = path.relative(path.parse(target).root, target).split(path.sep);
  if (parts.length < 3 || target === ROOT) throw new Error(`refusing unsafe output path: ${target}`);
}

function put(image, x, y, color, alpha = 255) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const at = offset(image, x, y);
  image.data[at] = color[0]; image.data[at + 1] = color[1]; image.data[at + 2] = color[2]; image.data[at + 3] = alpha;
}

function clearPixel(image, x, y) {
  const at = offset(image, x, y);
  image.data[at] = 0; image.data[at + 1] = 0; image.data[at + 2] = 0; image.data[at + 3] = 0;
}

function hashUnit(seed, x, y, lane = 0) {
  let value = Math.imul(seed ^ Math.imul(x + 101, 0x9e3779b1) ^ Math.imul(y + 211, 0x85ebca6b) ^ Math.imul(lane + 17, 0xc2b2ae35), 0x27d4eb2d);
  value = Math.imul(value ^ (value >>> 15), 0x165667b1);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
}

function reducedTopologyFrames() {
  const frames = [];
  for (let variant = 0; variant < 3; variant += 1) frames.push({ role: "interior", variant, direction: null, corner: null });
  for (const direction of ["n", "e", "s", "w"]) frames.push({ role: "boundary", variant: 0, direction, corner: null });
  for (const corner of ["ne", "se", "sw", "nw"]) frames.push({ role: "convex", variant: 0, direction: null, corner });
  for (const corner of ["ne", "se", "sw", "nw"]) frames.push({ role: "concave", variant: 0, direction: null, corner });
  for (const direction of ["n", "e", "s", "w"]) frames.push({ role: "termination", variant: 0, direction, corner: null });
  return frames;
}

function topologyFrames(family) {
  if (!DENSE_MASK_FAMILIES.has(family)) return reducedTopologyFrames();
  return CANONICAL_MASKS.flatMap((canonicalMask) => (
    canonicalMask === 255
      ? [0, 1, 2].map((variant) => ({ role: "interior", variant, direction: null, corner: null, canonicalMask }))
      : [{ role: "mask", variant: 0, direction: null, corner: null, canonicalMask }]
  ));
}

function rotateUv(u, v, direction) {
  if (direction === "e") return [v, 1 - u];
  if (direction === "s") return [1 - u, 1 - v];
  if (direction === "w") return [1 - v, u];
  return [u, v];
}

function cornerUv(u, v, corner) {
  if (corner === "se") return [v, 1 - u];
  if (corner === "sw") return [1 - u, 1 - v];
  if (corner === "nw") return [1 - v, u];
  return [u, v];
}

function topologyStrength(u, v, frame, wave) {
  if (frame.role === "interior") {
    const braid = Math.sin((u * (2.7 + frame.variant * 0.31) + v * 1.65 + wave) * Math.PI * 2);
    const cross = Math.sin((u * 1.25 - v * (2.2 + frame.variant * 0.21) - wave * 0.7) * Math.PI * 2);
    return Math.max(0, 0.52 + braid * 0.23 + cross * 0.19 - Math.abs(v - 0.5) * 0.18);
  }
  if (frame.role === "boundary") {
    const [a, b] = rotateUv(u, v, frame.direction);
    const ragged = 0.31 + Math.sin((a * 3.2 + wave) * Math.PI * 2) * 0.065 + Math.sin((a * 7.1 - wave) * Math.PI * 2) * 0.025;
    return Math.max(0, 1 - Math.abs(b - ragged) / 0.21);
  }
  if (frame.role === "termination") {
    const [a, b] = rotateUv(u, v, frame.direction);
    const width = 0.08 + (1 - b) * 0.17;
    const center = 0.5 + Math.sin((b * 4.1 + wave) * Math.PI * 2) * 0.055;
    return b > 0.72 ? 0 : Math.max(0, 1 - Math.abs(a - center) / width) * Math.max(0, 1 - b / 0.75);
  }
  const [a, b] = cornerUv(u, v, frame.corner);
  const edgeA = Math.max(0, 1 - Math.abs(b - (0.28 + Math.sin((a * 3.4 + wave) * Math.PI * 2) * 0.04)) / 0.18);
  const edgeB = Math.max(0, 1 - Math.abs(a - (0.28 + Math.sin((b * 3.1 - wave) * Math.PI * 2) * 0.04)) / 0.18);
  return frame.role === "convex" ? Math.max(edgeA, edgeB) * (a + b < 1.45 ? 1 : 0.25) : Math.max(edgeA, edgeB) * (a + b > 0.52 ? 1 : 0.3);
}

function screenToWorld(u, v) {
  const screenX = (u - 0.5) * 2;
  const screenY = (v - 0.5) * 2;
  return { x: (screenX + screenY) / 2, y: (screenY - screenX) / 2 };
}

function worldToPixel(config, x, y) {
  const screenX = x - y;
  const screenY = x + y;
  return {
    x: Math.round((0.5 + screenX / 2) * (config.width - 1)),
    y: Math.round((0.5 + screenY / 2) * (config.height - 1)),
  };
}

function denseMaskContains(u, v, frame, seed) {
  const point = screenToWorld(u, v);
  const tangentX = Math.sin((point.y * 5.1 + seed * 0.0007) * Math.PI) * 0.035;
  const tangentY = Math.sin((point.x * 5.7 - seed * 0.0009) * Math.PI) * 0.035;
  const connected = (direction) => (frame.canonicalMask & MASK_BITS[direction]) !== 0;
  const minX = connected("w") ? -0.53 : -0.42 - tangentX;
  const maxX = connected("e") ? 0.53 : 0.42 + tangentX;
  const minY = connected("n") ? -0.53 : -0.42 - tangentY;
  const maxY = connected("s") ? 0.53 : 0.42 + tangentY;
  if (point.x < minX || point.x > maxX || point.y < minY || point.y > maxY) return false;
  const corners = [
    ["ne", point.x - point.y], ["se", point.x + point.y],
    ["sw", -point.x + point.y], ["nw", -point.x - point.y],
  ];
  for (const [corner, reach] of corners) {
    const [first, second] = corner.split("");
    if (connected(first) && connected(second) && !connected(corner) && reach > 0.66 + tangentX * 0.5) return false;
  }
  return true;
}

function familyMark(family, x, y, seed) {
  const familyIndex = FAMILIES.indexOf(family);
  const coarseX = Math.floor(x / (4 + familyIndex % 3));
  const coarseY = Math.floor(y / (3 + (familyIndex + 1) % 2));
  const grain = hashUnit(seed, coarseX, coarseY, familyIndex);
  if (family === "woodland_floor") return grain > 0.43 && ((coarseX + coarseY * 2 + seed) % 5 !== 0);
  if (family === "understory_edge") return grain > 0.46 && ((coarseX - coarseY + seed) % 4 !== 0);
  if (family === "meadow_deep_rough_margin") return grain > 0.5 && ((coarseX + coarseY + seed) % 3 !== 0);
  if (family === "wet_shore") return grain > 0.47 && ((coarseX * 2 + coarseY + seed) % 5 !== 1);
  return grain > 0.51 && ((coarseX + coarseY * 3 + seed) % 4 !== 2);
}

function drawCluster(image, cx, cy, family, color, scale, seed) {
  const familyIndex = FAMILIES.indexOf(family);
  const shapes = [
    [[-2, 0], [-1, -1], [-1, 0], [0, 0], [1, 0], [1, 1], [2, 1]],
    [[-2, 1], [-1, 0], [0, -1], [0, 0], [1, 0], [1, 1], [2, 0]],
    [[-2, 0], [-1, 0], [0, -1], [0, 0], [0, 1], [1, 1], [2, 1]],
    [[-2, -1], [-1, -1], [-1, 0], [0, 0], [1, 0], [2, -1], [2, 0]],
    [[-2, 0], [-1, 1], [0, 0], [1, -1], [1, 0], [2, 0], [0, 1]],
  ][familyIndex];
  const mirror = hashUnit(seed, cx, cy, 8) > 0.5;
  for (const [dx0, dy] of shapes) {
    const dx = mirror ? -dx0 : dx0;
    const block = family === "wet_shore" && Math.abs(dx) === 2 ? Math.max(1, scale - 1) : scale;
    for (let yy = 0; yy < block; yy += 1) for (let xx = 0; xx < block; xx += 1) {
      put(image, cx + dx * scale + xx, cy + dy * scale + yy, color, 150 + Math.floor(hashUnit(seed, dx, dy, 9) * 90));
    }
  }
}

function makeFrame(tier, family, frame) {
  const config = TIERS[tier];
  const image = new PNG({ width: config.width, height: config.height });
  const seed = 0x472a + FAMILIES.indexOf(family) * 97 + topologyFrames(family).findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(frame)) * 31;
  const palette = FAMILY[family].colors;
  if (frame.canonicalMask != null) {
    // Sample the material in world space at every output pixel. Screen-space
    // square blocks turn into horizontal bands under an isometric D4 affine;
    // world-quantized grains keep the same texture character in every orbit.
    for (let y = 0; y < config.height; y += 1) for (let x = 0; x < config.width; x += 1) {
      const u = (x + 0.5) / config.width;
      const v = (y + 0.5) / config.height;
      if (!denseMaskContains(u, v, frame, seed)) continue;
      const world = screenToWorld(u, v);
      const grainX = Math.floor((world.x + 0.75) * 64);
      const grainY = Math.floor((world.y + 0.75) * 64);
      const grain = hashUnit(seed, grainX, grainY, frame.variant + 23);
      if (grain < 0.09) continue;
      const color = palette[Math.min(3, Math.floor(hashUnit(seed, grainX, grainY, 27) * 4))];
      const alpha = 176 + Math.floor(hashUnit(seed, grainX, grainY, 29) * 72);
      put(image, x, y, color, alpha);
    }
    const anchorRadius = Math.max(1, Math.floor(config.scale / 2));
    for (const edge of edgeAnchors(frame)) {
      const points = [-0.18, 0, 0.18].map((offset) => edge === "n" ? { x: offset, y: -0.5 }
        : edge === "e" ? { x: 0.5, y: offset }
          : edge === "s" ? { x: offset, y: 0.5 }
            : { x: -0.5, y: offset });
      for (const point of points) {
        const pixel = worldToPixel(config, point.x, point.y);
        for (let yy = -anchorRadius; yy <= anchorRadius; yy += 1) for (let xx = -anchorRadius; xx <= anchorRadius; xx += 1) {
          put(image, pixel.x + xx, pixel.y + yy, palette[1], 224);
        }
      }
    }
    // Final containment is authoritative: density, block drawing, and anchor
    // reinforcement may approach the projected world-tile edge but never
    // spill into a neighboring tile's diamond.
    for (let y = 0; y < config.height; y += 1) for (let x = 0; x < config.width; x += 1) {
      const world = screenToWorld((x + 0.5) / config.width, (y + 0.5) / config.height);
      if (Math.abs(world.x) > 0.5 || Math.abs(world.y) > 0.5) clearPixel(image, x, y);
    }
    return image;
  }
  const step = Math.max(2, config.scale * 3);
  for (let y = config.scale; y < config.height - config.scale; y += step) for (let x = config.scale; x < config.width - config.scale; x += step) {
    const u = x / (config.width - 1); const v = y / (config.height - 1);
    const strength = topologyStrength(u, v, frame, (FAMILIES.indexOf(family) + 1) * 0.137);
    if (strength < 0.32 || !familyMark(family, x / config.scale, y / config.scale, seed)) continue;
    const jitterX = Math.floor((hashUnit(seed, x, y, 1) - 0.5) * step * 0.8);
    const jitterY = Math.floor((hashUnit(seed, x, y, 2) - 0.5) * step * 0.55);
    const color = palette[Math.min(palette.length - 1, Math.floor(hashUnit(seed, x, y, 3) * palette.length))];
    drawCluster(image, x + jitterX, y + jitterY, family, color, config.scale, seed);
  }
  // Explicit irregular edge anchors make compatible topology meet without a
  // full-cell outline. They are small pixel clusters, never an ellipse/dash row.
  const anchors = edgeAnchors(frame);
  for (const edge of anchors) {
    const points = edge === "n" ? [[config.width / 2, 2], [config.width / 2 - step, 4]]
      : edge === "s" ? [[config.width / 2, config.height - 3], [config.width / 2 + step, config.height - 5]]
        : edge === "e" ? [[config.width - 3, config.height / 2], [config.width - 5, config.height / 2 - step / 2]]
          : [[2, config.height / 2], [4, config.height / 2 + step / 2]];
    for (const [x, y] of points) drawCluster(image, Math.round(x), Math.round(y), family, palette[1], config.scale, seed + 13);
  }
  return image;
}

function edgeAnchors(frame) {
  if (frame.canonicalMask != null) return ["n", "e", "s", "w"].filter((direction) => (
    (frame.canonicalMask & MASK_BITS[direction]) !== 0
  ));
  if (frame.role === "boundary" || frame.role === "termination") return [frame.direction];
  if (frame.role === "convex" || frame.role === "concave") return frame.corner.split("");
  return ["n", "e", "s", "w"];
}

function frameId(family, frame) {
  if (frame.canonicalMask != null) return `${family}--mask-${frame.canonicalMask.toString(16).padStart(2, "0")}-${frame.variant}`;
  if (frame.role === "interior") return `${family}--interior-${frame.variant}`;
  return `${family}--${frame.role}-${frame.direction || frame.corner}`;
}

function copyPixel(source, sx, sy, target, tx, ty) {
  const sourceAt = offset(source, sx, sy); const targetAt = offset(target, tx, ty);
  for (let channel = 0; channel < 4; channel += 1) target.data[targetAt + channel] = source.data[sourceAt + channel];
}

function regionHash(image) { return sha256(image.data); }

function makeTier(tier) {
  const config = TIERS[tier];
  const entries = [];
  for (const family of FAMILIES) for (const frame of topologyFrames(family)) {
    const image = makeFrame(tier, family, frame);
    entries.push({ id: frameId(family, frame), family, ...frame, image, sourceSha256: regionHash(image) });
  }
  const columns = 10; const rows = Math.ceil(entries.length / columns);
  const strideX = config.width + config.gutter * 2; const strideY = config.height + config.gutter * 2;
  const atlas = new PNG({ width: columns * strideX, height: rows * strideY });
  const frames = {};
  entries.forEach((entry, index) => {
    const x = (index % columns) * strideX + config.gutter;
    const y = Math.floor(index / columns) * strideY + config.gutter;
    for (let yy = -config.gutter; yy < config.height + config.gutter; yy += 1) for (let xx = -config.gutter; xx < config.width + config.gutter; xx += 1) {
      const sx = Math.max(0, Math.min(config.width - 1, xx)); const sy = Math.max(0, Math.min(config.height - 1, yy));
      copyPixel(entry.image, sx, sy, atlas, x + xx, y + yy);
    }
    frames[entry.id] = {
      id: entry.id, family: entry.family, topologyRole: entry.role,
      direction: entry.direction, corner: entry.corner, variant: entry.variant,
      canonicalMask: entry.canonicalMask ?? null,
      anchor: { x: config.width / 2, y: config.height / 2 },
      edgeAnchors: edgeAnchors(entry), frame: { x, y, width: config.width, height: config.height },
      sourceSha256: entry.sourceSha256,
    };
  });
  const imageBytes = PNG.sync.write(atlas, { deflateLevel: 9, deflateStrategy: 0 });
  const imageName = `${tier}/habitat-atlas.png`;
  mkdirSync(path.join(OUTPUT, tier), { recursive: true });
  writeFileSync(path.join(OUTPUT, imageName), imageBytes);
  const atlasJson = {
    version: 1, schema: "ParklandHabitatFieldAtlasV1", tier, image: "habitat-atlas.png",
    width: atlas.width, height: atlas.height, gutterPx: config.gutter,
    frameCount: entries.length, frames,
  };
  const jsonBytes = Buffer.from(`${JSON.stringify(atlasJson, null, 2)}\n`);
  const jsonName = `${tier}/habitat-atlas.json`;
  writeFileSync(path.join(OUTPUT, jsonName), jsonBytes);
  return {
    tier, scale: config.scale, width: atlas.width, height: atlas.height, gutterPx: config.gutter,
    frameWidth: config.width, frameHeight: config.height, frameCount: entries.length,
    image: imageName, imageBytes: imageBytes.length, imageSha256: sha256(imageBytes),
    json: jsonName, jsonBytes: jsonBytes.length, jsonSha256: sha256(jsonBytes), frames,
  };
}

const FONT = {
  A:["01110","10001","10001","11111","10001","10001","10001"], B:["11110","10001","11110","10001","10001","10001","11110"],
  C:["01111","10000","10000","10000","10000","10000","01111"], D:["11110","10001","10001","10001","10001","10001","11110"],
  E:["11111","10000","11110","10000","10000","10000","11111"], F:["11111","10000","11110","10000","10000","10000","10000"],
  G:["01111","10000","10000","10111","10001","10001","01111"],
  H:["10001","10001","10001","11111","10001","10001","10001"], I:["11111","00100","00100","00100","00100","00100","11111"],
  K:["10001","10010","10100","11000","10100","10010","10001"], L:["10000","10000","10000","10000","10000","10000","11111"],
  M:["10001","11011","10101","10101","10001","10001","10001"],
  N:["10001","11001","10101","10011","10001","10001","10001"], O:["01110","10001","10001","10001","10001","10001","01110"],
  P:["11110","10001","10001","11110","10000","10000","10000"], R:["11110","10001","10001","11110","10100","10010","10001"],
  S:["01111","10000","10000","01110","00001","00001","11110"], T:["11111","00100","00100","00100","00100","00100","00100"],
  U:["10001","10001","10001","10001","10001","10001","01110"],
  V:["10001","10001","10001","10001","10001","01010","00100"], Z:["11111","00001","00010","00100","01000","10000","11111"],
  W:["10001","10001","10001","10101","10101","11011","10001"],
  "4":["00010","00110","01010","10010","11111","00010","00010"], "7":["11111","00001","00010","00100","01000","01000","01000"],
  "3":["11110","00001","00001","01110","00001","00001","11110"], " ":["00000","00000","00000","00000","00000","00000","00000"],
  "—":["00000","00000","00000","11111","00000","00000","00000"], "-":["00000","00000","00000","11111","00000","00000","00000"],
};

function text(image, value, x, y, scale, color) {
  let cursor = x;
  for (const character of value.toUpperCase()) {
    const glyph = FONT[character] || FONT[" "];
    for (let row = 0; row < 7; row += 1) for (let column = 0; column < 5; column += 1) if (glyph[row][column] === "1") {
      for (let yy = 0; yy < scale; yy += 1) for (let xx = 0; xx < scale; xx += 1) put(image, cursor + column * scale + xx, y + row * scale + yy, color, 255);
    }
    cursor += 6 * scale;
  }
}

function blit(target, source, dx, dy, scale = 1) {
  for (let y = 0; y < source.height; y += 1) for (let x = 0; x < source.width; x += 1) {
    const at = offset(source, x, y); const alpha = source.data[at + 3] / 255;
    if (!alpha) continue;
    for (let sy = 0; sy < scale; sy += 1) for (let sx = 0; sx < scale; sx += 1) {
      const tx = dx + x * scale + sx; const ty = dy + y * scale + sy;
      if (tx < 0 || ty < 0 || tx >= target.width || ty >= target.height) continue;
      const to = offset(target, tx, ty);
      for (let channel = 0; channel < 3; channel += 1) target.data[to + channel] = Math.round(target.data[to + channel] * (1 - alpha) + source.data[at + channel] * alpha);
      target.data[to + 3] = 255;
    }
  }
}

function cropFrame(atlas, descriptor) {
  const result = new PNG({ width: descriptor.frame.width, height: descriptor.frame.height });
  for (let y = 0; y < result.height; y += 1) for (let x = 0; x < result.width; x += 1) copyPixel(atlas, descriptor.frame.x + x, descriptor.frame.y + y, result, x, y);
  return result;
}

function normalizeMask(mask) {
  let normalized = mask & 0xff;
  for (const [diagonal, first, second] of [
    ["ne", "n", "e"], ["se", "s", "e"], ["sw", "s", "w"], ["nw", "n", "w"],
  ]) {
    if ((mask & MASK_BITS[first]) === 0 || (mask & MASK_BITS[second]) === 0) normalized &= ~MASK_BITS[diagonal];
  }
  return normalized;
}

function transformPoint(point, transform) {
  const reflected = transform.startsWith("reflectX") ? { x: -point.x, y: point.y } : point;
  if (transform.endsWith("Rotate90") || transform === "rotate90") return { x: -reflected.y, y: reflected.x };
  if (transform.endsWith("Rotate180") || transform === "rotate180") return { x: -reflected.x, y: -reflected.y };
  if (transform.endsWith("Rotate270") || transform === "rotate270") return { x: reflected.y, y: -reflected.x };
  return { ...reflected };
}

function directionAt(point) {
  return Object.keys(MASK_OFFSETS).find((direction) => (
    MASK_OFFSETS[direction].x === point.x && MASK_OFFSETS[direction].y === point.y
  ));
}

function transformMask(mask, transform) {
  let result = 0;
  for (const [direction, point] of Object.entries(MASK_OFFSETS)) {
    if ((mask & MASK_BITS[direction]) === 0) continue;
    result |= MASK_BITS[directionAt(transformPoint(point, transform))];
  }
  return result;
}

function canonicalMaskTransform(rawMask) {
  const normalizedMask = normalizeMask(rawMask);
  const canonicalMask = Math.min(...D4_TRANSFORMS.map((transform) => transformMask(normalizedMask, transform)));
  const transform = D4_TRANSFORMS.find((candidate) => transformMask(canonicalMask, candidate) === normalizedMask);
  if (!transform || !CANONICAL_MASKS.includes(canonicalMask)) throw new Error(`missing D4 class for mask ${normalizedMask}`);
  return { normalizedMask, canonicalMask, transform };
}

function inverseTransform(transform) {
  if (transform === "rotate90") return "rotate270";
  if (transform === "rotate270") return "rotate90";
  return transform;
}

function transformDenseFrame(source, transform) {
  if (transform === "identity") return source;
  const target = new PNG({ width: source.width, height: source.height });
  const inverse = inverseTransform(transform);
  for (let y = 0; y < target.height; y += 1) for (let x = 0; x < target.width; x += 1) {
    const world = screenToWorld((x + 0.5) / target.width, (y + 0.5) / target.height);
    const canonical = transformPoint(world, inverse);
    const pixelPoint = worldToPixel(source, canonical.x, canonical.y);
    if (pixelPoint.x >= 0 && pixelPoint.y >= 0 && pixelPoint.x < source.width && pixelPoint.y < source.height) {
      copyPixel(source, pixelPoint.x, pixelPoint.y, target, x, y);
    }
  }
  return target;
}

function occupancyMask(occupied, cell) {
  const keys = new Set(occupied.map(({ x, y }) => `${x},${y}`));
  let mask = 0;
  for (const [direction, offsetPoint] of Object.entries(MASK_OFFSETS)) {
    if (keys.has(`${cell.x + offsetPoint.x},${cell.y + offsetPoint.y}`)) mask |= MASK_BITS[direction];
  }
  return mask;
}

function projectedCell(origin, cell) {
  return { x: origin.x + (cell.x - cell.y) * 64, y: origin.y + (cell.x + cell.y) * 32 };
}

function drawDenseComposition(proof, terrain, atlas, highTier, family, origin, propName) {
  // A connected ring around an empty source-tree cell, plus a one-cell neck.
  // The asymmetry necessarily exercises rotations/reflections instead of
  // repeating stamps, while the center proves the trunk-cell exclusion.
  const occupied = [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
    { x: 0, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 },
    { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 },
  ];
  const ordered = [...occupied].sort((left, right) => (left.x + left.y) - (right.x + right.y) || left.x - right.x);
  for (const cell of ordered) {
    const center = projectedCell(origin, cell);
    blitHalf(proof, terrain, center.x - terrain.width / 4, center.y - terrain.height / 4);
  }
  for (const cell of ordered) {
    const rawMask = occupancyMask(occupied, cell);
    const { canonicalMask, transform } = canonicalMaskTransform(rawMask);
    const variant = canonicalMask === 255 ? (cell.x + cell.y) % 3 : 0;
    const id = `${family}--mask-${canonicalMask.toString(16).padStart(2, "0")}-${variant}`;
    const frame = transformDenseFrame(cropFrame(atlas, highTier.frames[id]), transform);
    const center = projectedCell(origin, cell);
    blitHalf(proof, frame, center.x - frame.width / 4, center.y - frame.height / 4);
  }
  const sourceCell = projectedCell(origin, { x: 1, y: 1 });
  const prop = PNG.sync.read(readFileSync(path.join(ROOT, "src/assets/props/natural", propName)));
  blitHalf(proof, prop, Math.round(sourceCell.x - prop.width / 4), Math.round(sourceCell.y - prop.height / 2 + 9));
}

function blitHalf(target, source, dx, dy) {
  for (let y = 0; y < Math.ceil(source.height / 2); y += 1) for (let x = 0; x < Math.ceil(source.width / 2); x += 1) {
    const sx = Math.min(source.width - 1, x * 2); const sy = Math.min(source.height - 1, y * 2);
    const sourceAt = offset(source, sx, sy); const alpha = source.data[sourceAt + 3] / 255;
    if (!alpha) continue;
    const tx = dx + x; const ty = dy + y;
    if (tx < 0 || ty < 0 || tx >= target.width || ty >= target.height) continue;
    const targetAt = offset(target, tx, ty);
    for (let channel = 0; channel < 3; channel += 1) {
      target.data[targetAt + channel] = Math.round(target.data[targetAt + channel] * (1 - alpha) + source.data[sourceAt + channel] * alpha);
    }
    target.data[targetAt + 3] = 255;
  }
}

function makeProof(highTier) {
  const proof = new PNG({ width: 1440, height: 900 });
  for (let y = 0; y < proof.height; y += 1) for (let x = 0; x < proof.width; x += 1) put(proof, x, y, [25 + Math.floor(y / 160), 32 + Math.floor(y / 180), 26], 255);
  text(proof, "ASSET PROOF — NOT ZK-473 EVIDENCE", 44, 28, 4, [231, 221, 181]);
  text(proof, "CONNECTED HABITAT FIELD / REAL PARKLAND PROPS", 46, 72, 2, [157, 184, 125]);
  const terrain = PNG.sync.read(readFileSync(path.join(ROOT, "src/assets/terrain/parkland-4x/parkland_rough_base_0.png")));
  const atlas = PNG.sync.read(readFileSync(path.join(OUTPUT, highTier.image)));
  text(proof, "WOODLAND / TREE HOLE + BRIDGE", 46, 116, 2, [215, 205, 163]);
  text(proof, "UNDERSTORY / TREE HOLE + D4", 784, 116, 2, [215, 205, 163]);
  drawDenseComposition(proof, terrain, atlas, highTier, "woodland_floor", { x: 290, y: 196 }, "parkland_tree_oak.png");
  drawDenseComposition(proof, terrain, atlas, highTier, "understory_edge", { x: 1010, y: 196 }, "parkland_tree_pine.png");

  const reduced = FAMILIES.slice(2);
  reduced.forEach((family, index) => {
    const left = 54 + index * 466;
    text(proof, family.replaceAll("_", " "), left, 646, 2, [215, 205, 163]);
    const ids = [`${family}--termination-e`, `${family}--boundary-w`];
    ids.forEach((id, cell) => {
      blitHalf(proof, terrain, left + 26 + cell * 112, 686 + cell * 32);
      blitHalf(proof, cropFrame(atlas, highTier.frames[id]), left + 26 + cell * 112, 686 + cell * 32);
    });
  });
  const accents = ["parkland_bush_wildflowers.png", "parkland_rock_granite.png"];
  accents.forEach((name, index) => {
    const prop = PNG.sync.read(readFileSync(path.join(ROOT, "src/assets/props/natural", name)));
    blitHalf(proof, prop, 1070 + index * 145, 742 - Math.floor(prop.height / 2));
  });
  const proofBytes = PNG.sync.write(proof, { deflateLevel: 9, deflateStrategy: 0 });
  mkdirSync(path.join(OUTPUT, "evidence"), { recursive: true });
  writeFileSync(path.join(OUTPUT, "evidence/asset-proof-not-zk473.png"), proofBytes);
  return { file: "evidence/asset-proof-not-zk473.png", width: proof.width, height: proof.height, bytes: proofBytes.length, sha256: sha256(proofBytes), label: "ASSET PROOF — NOT ZK-473 EVIDENCE" };
}

assertSafeOutput(OUTPUT);
rmSync(OUTPUT, { recursive: true, force: true });
mkdirSync(OUTPUT, { recursive: true });
const sourceHash = sha256(Buffer.concat([readFileSync(path.join(ROOT, CONTRACT)), readFileSync(path.join(ROOT, GENERATOR))]));
const tiers = Object.fromEntries(Object.keys(TIERS).map((tier) => [tier, makeTier(tier)]));
const proof = makeProof(tiers.high);
const manifest = {
  schema: "ParklandHabitatFieldManifestV1", version: 1, id: "parkland-habitat-field-source-v1",
  contract: "../contracts/parkland-habitat-field-v1.json", generatedBy: GENERATOR,
  source: { sha256: sourceHash, author: "CourseCraft", externalProvider: "none", referencePixelsCopied: false, license: "project-original", kind: "deterministic-procedural-original" },
  authority: { visualOnly: true, collision: false, obstacle: false, canopy: false, simulation: false, treeSpritesRemainAuthoritative: true },
  vocabulary: {
    revision: 2,
    families: FAMILIES,
    topologyRoles: ["interior", "boundary", "convex", "concave", "termination", "mask"],
    denseMaskFamilies: [...DENSE_MASK_FAMILIES],
    normalizedMaskCount: 47,
    canonicalMasks: CANONICAL_MASKS,
    d4Transforms: D4_TRANSFORMS,
    patterns: Object.fromEntries(FAMILIES.map((family) => [family, FAMILY[family].pattern])),
  },
  paletteTransforms: PALETTE_TRANSFORMS, tiers, proof,
  budgets: { sourceBytesMax: 4194304, atlasBytesMaxPerTier: 2097152, totalAtlasBytesMax: 4194304, selectedTierDecodedBytesMax: 14680064, runtimeBytesAdded: 0, fileCountMax: 12 },
  rollback: { legacy2xUnchanged: true, runtimeImportsAdded: 0, action: "delete this source-only sidecar and its generator/audit registration" },
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(path.join(OUTPUT, "manifest.json"), manifestBytes);
writeFileSync(path.join(OUTPUT, "manifest.sha256"), `${sha256(manifestBytes)}  manifest.json\n`);
const totalBytes = ["manifest.json", "manifest.sha256", proof.file, ...Object.values(tiers).flatMap((tier) => [tier.image, tier.json])]
  .reduce((total, relative) => total + statSync(path.join(OUTPUT, relative)).size, 0);
console.log(`wrote ParklandHabitatFieldManifestV1 (${Object.keys(tiers.high.frames).length} frames/tier, ${totalBytes} bytes) to ${OUTPUT}`);

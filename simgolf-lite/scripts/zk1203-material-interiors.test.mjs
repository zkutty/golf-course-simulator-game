import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PNG } from "pngjs";

const ROOT = new URL("../", import.meta.url);
const QUALITIES = ["high", "medium"];
const INTERIORS = [
  "fairway", "green", "tee", "rough", "deep_rough", "sand",
  "water", "wetland", "waste_area",
];

function sourcePath(quality, terrain) {
  return join(new URL(ROOT).pathname, "src/assets/terrain/fields/parkland", quality, `${terrain}.png`);
}

function image(quality, terrain) {
  return PNG.sync.read(readFileSync(sourcePath(quality, terrain)));
}

function luminance(png, x, y) {
  const offset = (y * png.width + x) * 4;
  return png.data[offset] * 0.2126 + png.data[offset + 1] * 0.7152 + png.data[offset + 2] * 0.0722;
}

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * Pixel-frequency and wrap metrics intentionally work on decoded pixels, not
 * PNG bytes.  They therefore catch a visually flat, tiled, or stripe-heavy
 * regression even when the content-addressed output has a new hash.
 */
function metrics(png) {
  let horizontal = 0;
  let vertical = 0;
  let horizontalPairs = 0;
  let plateaus = 0;
  const wrapX = [];
  const wrapY = [];
  const blockMeans = [];
  const blockSize = png.width / 8;

  for (let y = 0; y < png.height; y++) {
    wrapX.push(Math.abs(luminance(png, 0, y) - luminance(png, png.width - 1, y)));
    for (let x = 0; x < png.width; x++) {
      if (x < png.width - 1) {
        const delta = Math.abs(luminance(png, x, y) - luminance(png, x + 1, y));
        horizontal += delta;
        horizontalPairs++;
        if (delta < 0.5) plateaus++;
      }
      if (y < png.height - 1) vertical += Math.abs(luminance(png, x, y) - luminance(png, x, y + 1));
    }
  }
  for (let x = 0; x < png.width; x++) wrapY.push(Math.abs(luminance(png, x, 0) - luminance(png, x, png.height - 1)));
  for (let blockY = 0; blockY < 8; blockY++) for (let blockX = 0; blockX < 8; blockX++) {
    let total = 0;
    for (let y = blockY * blockSize; y < (blockY + 1) * blockSize; y++) {
      for (let x = blockX * blockSize; x < (blockX + 1) * blockSize; x++) total += luminance(png, x, y);
    }
    blockMeans.push(total / (blockSize * blockSize));
  }
  const blockMean = mean(blockMeans);
  return {
    horizontal: horizontal / horizontalPairs,
    vertical: vertical / horizontalPairs,
    plateauRatio: plateaus / horizontalPairs,
    wrapX: mean(wrapX),
    wrapY: mean(wrapY),
    blockDeviation: Math.sqrt(mean(blockMeans.map((value) => (value - blockMean) ** 2))),
  };
}

function averageColor(png) {
  const channels = [0, 0, 0];
  for (let offset = 0; offset < png.data.length; offset += 4) {
    channels[0] += png.data[offset];
    channels[1] += png.data[offset + 1];
    channels[2] += png.data[offset + 2];
  }
  return channels.map((channel) => channel / (png.width * png.height));
}

function distance(a, b) {
  return Math.hypot(...a.map((value, index) => value - b[index]));
}

test("ZK-1203 Parkland high and medium fields retain the bounded interior set", () => {
  for (const quality of QUALITIES) {
    for (const terrain of INTERIORS) {
      const png = image(quality, terrain);
      assert.equal(png.width, quality === "high" ? 512 : 256);
      assert.equal(png.height, quality === "high" ? 512 : 256);
      for (let offset = 3; offset < png.data.length; offset += 4) assert.equal(png.data[offset], 255);
    }
  }
});

test("ZK-1203 keeps every repeat-safe field quiet at its wrap edges", () => {
  for (const quality of QUALITIES) for (const terrain of INTERIORS) {
    const result = metrics(image(quality, terrain));
    assert.ok(result.wrapX < 1.1, `${quality}/${terrain} horizontal wrap is ${result.wrapX}`);
    assert.ok(result.wrapY < 1.1, `${quality}/${terrain} vertical wrap is ${result.wrapY}`);
  }
});

test("ZK-1203 gives maintained turf a subordinate mowing cue", () => {
  for (const quality of QUALITIES) for (const terrain of ["fairway", "green", "tee"]) {
    const result = metrics(image(quality, terrain));
    // A hard vertical stripe grid would make horizontal deltas dominate;
    // keeping this ratio above 0.6 leaves the material hierarchy in charge.
    assert.ok(result.vertical / result.horizontal > 0.6, `${quality}/${terrain} mowing is dominant`);
  }
});

test("ZK-1203 gives sand fine rake rhythm and water restrained depth with ripple", () => {
  for (const quality of QUALITIES) {
    const sand = metrics(image(quality, "sand"));
    assert.ok(sand.vertical / sand.horizontal > 1.25, `${quality}/sand has no horizontal rake rhythm`);
    assert.ok(sand.plateauRatio < 0.85, `${quality}/sand is too flat or chip-dominated`);

    const water = metrics(image(quality, "water"));
    assert.ok(water.vertical / water.horizontal > 1.5, `${quality}/water has no fine ripple direction`);
    assert.ok(water.blockDeviation > 0.5 && water.blockDeviation < 2, `${quality}/water depth variation is not restrained`);
  }
});

test("ZK-1203 keeps rough and deep rough continuous but materially distinct", () => {
  for (const quality of QUALITIES) {
    const rough = metrics(image(quality, "rough"));
    const deepRough = metrics(image(quality, "deep_rough"));
    assert.ok(rough.horizontal > 0.15 && rough.vertical > 0.1, `${quality}/rough lacks continuous grain`);
    assert.ok(deepRough.horizontal > rough.horizontal && deepRough.vertical > rough.vertical, `${quality}/deep_rough is not denser than rough`);
    assert.ok(
      distance(averageColor(image(quality, "rough")), averageColor(image(quality, "deep_rough"))) > 18,
      `${quality} rough tiers are not visually distinct`,
    );
  }
});

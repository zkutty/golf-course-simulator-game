import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PNG } from "pngjs";

const ROOT = new URL("../", import.meta.url);
const QUALITIES = ["high", "medium"];
const INTERIORS = [
  "fairway", "green", "tee", "rough", "deep_rough", "sand",
  "water", "wetland", "waste_area",
];
// Decoded RGBA hashes from the rejected pre-attempt-2 field set.  Encoding
// changes alone cannot satisfy this gate: each retained field must carry new
// authored material information.
const REJECTED_PIXEL_HASHES = {
  "high/fairway": "998a1519e4fbcca2a6308b18e0052519abbdf7c834d9d839ff32c556fa784342",
  "high/green": "3e77c3f780be18e08092d753de707ea8e63a2f36644ec2959043f5ebfb992731",
  "high/tee": "75e721ffbadead51243e8a409270ca4f3a4cc7584993e7e94b45555be1d13cb5",
  "high/rough": "ebadc635f84ca1ce0329102f2b46e48a1d3118a8b5f606e9b2b7d8b930c82ef5",
  "high/deep_rough": "9a2a066d9b225d754a02bbd89de61efc5a40a93f73b5dd88694eed33360e5fd7",
  "high/sand": "800c134f22c45c633a5b78f9fe49ba66bacc48d4e550f8ed1d08e452c4904907",
  "high/water": "667e698a92452e13dd18c1f40beb8e4f3d2cf40b0397f450c140756a64876d6d",
  "high/wetland": "9ebd99b7bfd2f249959af693d7b91fd5bb8a08b1ca2546349025a3e176e8ebea",
  "high/waste_area": "6b8d55ef03c7900ab4866d7ae54dc518edfc80bc981f491e2b1fe6687ebce0ca",
  "medium/fairway": "28ed70f6ea55a7e2290ffaa3417b5ff369c00e279d32af065770b5af6ace550a",
  "medium/green": "5cc0a686b67ee2b069ec2c509b80efa8a7022195daeb88515a2f4378eb82859a",
  "medium/tee": "34ed588ece08834d601cf8ac0f023b63591c5ba369e74527267b120c87f40c34",
  "medium/rough": "29611a065eefaa6fa3060e18c51087660772211cce6d93a195017c8a9deeeee6",
  "medium/deep_rough": "5705b724eed3b2a3b6b3f5ed536531100199299dbc2c25c27ac0c1984b4164f5",
  "medium/sand": "1f7dc7286d8e59c536efe25d29941e1903f50a01815350b76495131e745ab8f9",
  "medium/water": "c0f7c5ef351175fd168022fb86465c2baf5b8b8255455977837bac929419943c",
  "medium/wetland": "6a05befe368dff5a680ec6a1c9ce664ca9b27e14c004a573c7846d51b0abb6d8",
  "medium/waste_area": "67fd2954798dbc295d959cfa080f79da36679e25e93cf491bb02306152197672",
};

function sourcePath(quality, terrain) {
  return join(new URL(ROOT).pathname, "src/assets/terrain/fields/parkland", quality, `${terrain}.png`);
}

function image(quality, terrain) {
  return PNG.sync.read(readFileSync(sourcePath(quality, terrain)));
}

function sourceBytes(quality, terrain) {
  return readFileSync(sourcePath(quality, terrain));
}

function pixelHash(png) {
  return createHash("sha256").update(png.data).digest("hex");
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
  let luminanceTotal = 0;
  let luminanceSquaredTotal = 0;
  let detailTotal = 0;
  let detailX = 0;
  let detailY = 0;
  const wrapX = [];
  const wrapY = [];
  const blockMeans = [];
  const blockSize = png.width / 8;

  for (let y = 0; y < png.height; y++) {
    wrapX.push(Math.abs(luminance(png, 0, y) - luminance(png, png.width - 1, y)));
    for (let x = 0; x < png.width; x++) {
      const value = luminance(png, x, y);
      luminanceTotal += value;
      luminanceSquaredTotal += value ** 2;
      if (x < png.width - 1) {
        const delta = Math.abs(value - luminance(png, x + 1, y));
        horizontal += delta;
        horizontalPairs++;
        if (delta < 0.5) plateaus++;
        if (y < png.height - 1) {
          const weight = delta + Math.abs(value - luminance(png, x, y + 1));
          detailTotal += weight;
          detailX += (x + 0.5) * weight;
          detailY += (y + 0.5) * weight;
        }
      }
      if (y < png.height - 1) vertical += Math.abs(value - luminance(png, x, y + 1));
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
  const pixelCount = png.width * png.height;
  const meanLuminance = luminanceTotal / pixelCount;
  return {
    horizontal: horizontal / horizontalPairs,
    vertical: vertical / horizontalPairs,
    plateauRatio: plateaus / horizontalPairs,
    wrapX: mean(wrapX),
    wrapY: mean(wrapY),
    blockDeviation: Math.sqrt(mean(blockMeans.map((value) => (value - blockMean) ** 2))),
    rmsContrast: Math.sqrt((luminanceSquaredTotal / pixelCount) - meanLuminance ** 2),
    detailCentroidX: detailX / detailTotal / png.width,
    detailCentroidY: detailY / detailTotal / png.height,
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

test("ZK-1203 fields contain new decoded material information, not only new PNG encoding", () => {
  for (const quality of QUALITIES) for (const terrain of INTERIORS) {
    assert.notEqual(
      pixelHash(image(quality, terrain)),
      REJECTED_PIXEL_HASHES[`${quality}/${terrain}`],
      `${quality}/${terrain} retained rejected decoded pixels`,
    );
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

test("ZK-1203 retains bounded contrast and fine-detail envelopes", () => {
  for (const quality of QUALITIES) {
    for (const terrain of ["fairway", "green", "tee"]) {
      const result = metrics(image(quality, terrain));
      assert.ok(result.rmsContrast > 4.5 && result.rmsContrast < 7.5, `${quality}/${terrain} turf contrast drifted`);
      assert.ok(result.horizontal > 0.15 && result.vertical > 0.12, `${quality}/${terrain} turf detail flattened`);
    }
    for (const terrain of ["rough", "deep_rough"]) {
      const result = metrics(image(quality, terrain));
      assert.ok(result.rmsContrast > 2.8 && result.rmsContrast < 5, `${quality}/${terrain} wild-turf contrast drifted`);
      assert.ok(result.horizontal > 0.15 && result.vertical > 0.12, `${quality}/${terrain} wild-turf detail flattened`);
    }
    const sand = metrics(image(quality, "sand"));
    assert.ok(sand.rmsContrast > 5.8 && sand.rmsContrast < 7.5, `${quality}/sand contrast drifted`);
    for (const terrain of ["water", "wetland"]) {
      const result = metrics(image(quality, terrain));
      assert.ok(result.rmsContrast > 1.25 && result.rmsContrast < 2.4, `${quality}/${terrain} depth contrast drifted`);
      assert.ok(result.vertical > result.horizontal * 1.5, `${quality}/${terrain} lost directional fine detail`);
    }
  }
});

test("ZK-1203 keeps detail balanced instead of concentrating it on one edge", () => {
  for (const quality of QUALITIES) for (const terrain of INTERIORS) {
    const result = metrics(image(quality, terrain));
    assert.ok(result.detailCentroidX > 0.45 && result.detailCentroidX < 0.55, `${quality}/${terrain} detail x centroid drifted`);
    assert.ok(result.detailCentroidY > 0.45 && result.detailCentroidY < 0.55, `${quality}/${terrain} detail y centroid drifted`);
  }
});

test("ZK-1203 public manifest references exact Parkland field bytes", () => {
  const root = new URL(ROOT).pathname;
  const manifest = JSON.parse(readFileSync(join(root, "public/atlases/biomes/manifest.json"), "utf8"));
  for (const quality of QUALITIES) for (const terrain of INTERIORS) {
    const field = manifest.biomes.parkland[quality].base.fields[terrain];
    const publicPath = join(root, "public/atlases/biomes", field.image);
    const source = sourceBytes(quality, terrain);
    assert.ok(existsSync(publicPath), `${quality}/${terrain} public field is absent`);
    assert.deepEqual(readFileSync(publicPath), source, `${quality}/${terrain} public field diverged from source`);
    const hash = createHash("sha256").update(source).digest("hex").slice(0, 12);
    assert.ok(field.image.includes(`.${hash}.png`), `${quality}/${terrain} manifest hash is stale`);
  }
});

test("ZK-1203 generator is byte-identical and reproduces the approved fields", () => {
  const root = new URL(ROOT).pathname;
  const scratch = mkdtempSync(join(tmpdir(), "zk1203-fields-"));
  try {
    const generate = (name) => {
      const output = join(scratch, name);
      const result = spawnSync(process.execPath, [join(root, "scripts/gen-m35-landscape-fields.mjs")], {
        env: { ...process.env, ZK1203_INTERIORS_ONLY: "1", COURSECRAFT_M35_FIELD_OUTPUT_DIR: output },
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      return output;
    };
    const first = generate("first");
    const second = generate("second");
    for (const quality of QUALITIES) for (const terrain of INTERIORS) {
      const relative = join("parkland", quality, `${terrain}.png`);
      const source = sourceBytes(quality, terrain);
      assert.deepEqual(readFileSync(join(first, relative)), source, `${quality}/${terrain} generator bytes changed`);
      assert.deepEqual(readFileSync(join(first, relative)), readFileSync(join(second, relative)), `${quality}/${terrain} generator is not deterministic`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

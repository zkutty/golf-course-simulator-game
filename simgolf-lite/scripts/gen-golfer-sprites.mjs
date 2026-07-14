// Generates the procedural golfer character sprites (ZKU-153) per
// ART_GUIDE.md: chibi proportions (~2.5 heads), 48x72 canvas, feet at
// bottom-center, NW light, 1px darkened outline, <=4 value steps.
//
// The characters are built from a tiny "3D-lite" part model (side/forward/up
// coordinates) projected with the same 2:1 dimetric math the renderer uses,
// so one model yields every direction row. Five direction rows are authored
// per animation; the renderer mirrors them for the remaining three octants.
//
// Two layers per frame: the BASE layer (skin, pants, shoes, club) is drawn
// in real colors; the TINT layer (shirt + hat) is authored in grayscale and
// multiplied with the golfer's color at runtime (Pixi sprite tint) — one
// sheet serves every archetype palette.
//
// Output: grid sheets in src/assets/sprites/golfers/, one file per
// (variant, animation, layer): golfer{v}_{anim}.grid{COLS}x{ROWS}.png and
// golfer{v}_{anim}_t.grid{COLS}x{ROWS}.png. build-atlas.mjs slices grids
// into frames named `${base}_${row}_${col}`.
//
// Direction row conventions (index 0..4):
// - walk/idle rows are FACING octants [s, sw, w, nw, n]
// - swing/putt rows are ball TARGET octants [s, sw, w, nw, n] (the stance
//   faces 90° off-target like a real golfer; mirrored rows read as
//   left-handers, which is invisible in practice)
// - cheer/mad are single-row, facing the camera (s)
//
// Usage: npm run gen:sprites (runs after the prop generator)
import { PNG } from "pngjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/assets/sprites/golfers"
);
mkdirSync(OUT, { recursive: true });

const FW = 48; // frame width
const FH = 72; // frame height
const ANCHOR_X = 24;
const ANCHOR_Y = 69; // feet line (ground anchor is bottom-center per ART_GUIDE)

const BASE = 0; // layer ids
const TINT = 1;

const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const darken = ([r, g, b], f) => [
  Math.min(255, Math.round(r * f)),
  Math.min(255, Math.round(g * f)),
  Math.min(255, Math.round(b * f)),
];

// World angles (degrees) whose 2:1 dimetric projection FACES each screen
// octant row. F_world = (cos, sin); screen = (Fx - Fy, (Fx + Fy) / 2).
const FACING_PSI = { s: 45, sw: 90, w: 135, nw: 180, n: 225 };
// World angles whose LEFT side (+S = ball target for a right-hander) points
// at each screen octant row.
const TARGET_PSI = { s: 135, sw: 180, w: 225, nw: 270, n: 315 };
const ROWS = ["s", "sw", "w", "nw", "n"];

// Projection basis for a world angle psi: screen offsets per unit of
// side (s, character's left), forward (f) and up (h) model coordinates.
function basis(psiDeg) {
  const a = (psiDeg * Math.PI) / 180;
  const F = { x: Math.cos(a) - Math.sin(a), y: (Math.cos(a) + Math.sin(a)) / 2 };
  const S = { x: Math.cos(a) + Math.sin(a), y: (Math.sin(a) - Math.cos(a)) / 2 };
  // Painter depth per unit of s/f (world x+y grows toward the camera).
  const depthS = Math.sin(a) - Math.cos(a);
  const depthF = Math.cos(a) + Math.sin(a);
  return { F, S, depthS, depthF };
}

// --- Frame buffer with per-pixel layer tags -------------------------------

function makeBuf() {
  return {
    color: new Uint8Array(FW * FH * 3),
    alpha: new Uint8Array(FW * FH),
    layer: new Uint8Array(FW * FH),
  };
}

function putPx(buf, x, y, rgb, layer) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= FW || y >= FH) return;
  const i = y * FW + x;
  buf.color[i * 3] = rgb[0];
  buf.color[i * 3 + 1] = rgb[1];
  buf.color[i * 3 + 2] = rgb[2];
  buf.alpha[i] = 255;
  buf.layer[i] = layer;
}

// A "part" is a screen-space ellipse with NW-lit band shading and a painter
// depth. Frames are lists of parts, depth-sorted then rasterized.
function ellipsePart(cx, cy, rx, ry, rgb, layer, depth, opts = {}) {
  return {
    depth,
    draw(buf) {
      const lit = darken(rgb, opts.flat ? 1 : 1.14);
      const shad = darken(rgb, opts.flat ? 1 : 0.82);
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          const nx = (x - cx) / rx;
          const ny = (y - cy) / ry;
          if (nx * nx + ny * ny > 1) continue;
          const l = nx * 0.7 + ny * 0.7; // NW..SE band
          let c = rgb;
          if (!opts.flat) {
            if (l < -0.5) c = lit;
            else if (l > 0.55) c = shad;
            if ((x * 7 + y * 13) % 11 === 0 && Math.abs(l) < 0.7) c = darken(c, 0.94);
          }
          putPx(buf, x, y, c, layer);
        }
      }
    },
  };
}

// Model-space helpers bound to a projection basis. All draw code below works
// in (s, f, h) model pixels; these convert to screen parts.
function projector(b) {
  const px = (s, f) => ANCHOR_X + s * b.S.x + f * b.F.x;
  const py = (s, f, h) => ANCHOR_Y - h + s * b.S.y + f * b.F.y;
  const depth = (s, f, h) => s * b.depthS + f * b.depthF + h * 1e-3;
  return {
    px,
    py,
    depth,
    blob(s, f, h, rx, ry, rgb, layer, extraDepth = 0) {
      return ellipsePart(px(s, f), py(s, f, h), rx, ry, rgb, layer, depth(s, f, h) + extraDepth);
    },
    // Capsule between two model points, rasterized as depth-sorted discs so
    // limbs and club occlude correctly against the body.
    capsule(p0, p1, r, rgb, layer, parts, shadeEnd = 1) {
      const steps = Math.max(2, Math.ceil(Math.hypot(px(p1.s, p1.f) - px(p0.s, p0.f), py(p1.s, p1.f, p1.h) - py(p0.s, p0.f, p0.h)) / (r * 0.7)));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const s = p0.s + (p1.s - p0.s) * t;
        const f = p0.f + (p1.f - p0.f) * t;
        const h = p0.h + (p1.h - p0.h) * t;
        const c = darken(rgb, 1 - (1 - shadeEnd) * t);
        parts.push(ellipsePart(px(s, f), py(s, f, h), r, r * 0.9, c, layer, depth(s, f, h), { flat: true }));
      }
    },
  };
}

// --- Variant looks --------------------------------------------------------
// Shirt/hat live on the TINT layer in grayscale (~2 value steps under the
// blob shader); everything else is base-layer color.
const GRAY_SHIRT = [204, 204, 204];
const GRAY_HAT = [226, 226, 226];

const VARIANTS = [
  {
    // v0: ball cap + polo, khaki slacks — the club regular
    skin: hex("#e8b58a"),
    pants: hex("#b09a6e"),
    shoes: hex("#e6e6e0"),
    hat: "cap",
    torsoR: 8.4,
  },
  {
    // v1: bare head + polo, slate slacks — the walk-on
    skin: hex("#b97f4e"),
    hair: hex("#5d4330"),
    pants: hex("#7a7f8a"),
    shoes: hex("#4a4a44"),
    hat: "none",
    torsoR: 8.0,
  },
  {
    // v2: bucket hat, olive trousers — the sunday veteran (stockier)
    skin: hex("#e8b58a"),
    pants: hex("#55663f"),
    shoes: hex("#6b4f33"),
    hat: "bucket",
    torsoR: 9.2,
  },
];

const CLUB_SHAFT = [154, 154, 154];
const CLUB_HEAD = [104, 104, 104];

// --- Character assembly ----------------------------------------------------
// pose: everything animatable, in model px.
//   legL/legR: {fwd, lift}; armL/armR: {s, f, h} hand position;
//   bob: body raise; lean: {s, f} upper-body shift; jump: whole-body raise;
//   club: null | {hand: 'L'|'R'|'both', head: {s,f,h}} — shaft drawn from
//   hands to head; headTilt: forward head pitch (mad pose).
function drawGolfer(buf, psiDeg, v, pose) {
  const b = basis(psiDeg);
  const P = projector(b);
  const parts = [];
  const jump = pose.jump ?? 0;
  const bob = (pose.bob ?? 0) + jump;
  const leanS = pose.lean?.s ?? 0;
  const leanF = pose.lean?.f ?? 0;

  const HIP = 11;
  // Legs + shoes
  for (const side of [-1, 1]) {
    const leg = side < 0 ? pose.legL : pose.legR;
    const fwd = leg?.fwd ?? 0;
    const lift = (leg?.lift ?? 0) + jump;
    P.capsule(
      { s: side * 3.1, f: 0, h: HIP + bob * 0.5 },
      { s: side * 3.1, f: fwd, h: lift + 2 },
      2.1,
      v.pants,
      BASE,
      parts,
      0.85
    );
    parts.push(P.blob(side * 3.1, fwd + 1.2, lift + 1.2, 2.6, 1.7, v.shoes, BASE));
  }

  // Torso (shirt — tint layer)
  const torsoH = 17.5 + bob;
  parts.push(P.blob(leanS * 0.6, 0.4 + leanF * 0.6, torsoH, v.torsoR, v.torsoR * 0.92, GRAY_SHIRT, TINT));

  // Arms (skin) — hands are free points so swings/cheers read
  for (const side of [-1, 1]) {
    const arm = side < 0 ? pose.armL : pose.armR;
    const hand = arm ?? { s: side * 7.6, f: 1.5, h: 13 };
    P.capsule(
      { s: side * 6.6 + leanS * 0.6, f: 0.6 + leanF * 0.6, h: 22 + bob },
      { s: hand.s, f: hand.f, h: hand.h + bob * 0.5 },
      1.9,
      v.skin,
      BASE,
      parts,
      0.9
    );
  }

  // Club: shaft from the lead hand to the club head, small head blob.
  if (pose.club) {
    const hand = pose.club.hand === "L" ? pose.armL : pose.armR;
    const from = hand ?? { s: 7, f: 2, h: 13 };
    P.capsule(
      { s: from.s, f: from.f, h: from.h + bob * 0.5 },
      pose.club.head,
      1.1,
      CLUB_SHAFT,
      BASE,
      parts,
      1
    );
    parts.push(P.blob(pose.club.head.s, pose.club.head.f, pose.club.head.h, 2.8, 1.8, CLUB_HEAD, BASE));
  }

  // Head + hat
  const headH = 33 + bob + (pose.headDrop ?? 0);
  const headS = leanS;
  const headF = 0.8 + leanF;
  parts.push(P.blob(headS, headF, headH, 8, 7.6, v.skin, BASE, 0.02));
  if (v.hat === "cap") {
    parts.push(P.blob(headS, headF - 0.6, headH + 5.5, 7.2, 4.4, GRAY_HAT, TINT, 0.04));
    parts.push(P.blob(headS, headF + 6.2, headH + 5.6, 4.6, 1.8, darken(GRAY_HAT, 0.9), TINT, 0.05));
  } else if (v.hat === "bucket") {
    parts.push(P.blob(headS, headF, headH + 5.2, 8.2, 4.6, GRAY_HAT, TINT, 0.04));
    parts.push(P.blob(headS, headF + 1, headH + 1.8, 9.6, 3.4, darken(GRAY_HAT, 0.88), TINT, 0.05));
  } else {
    parts.push(P.blob(headS, headF - 1.4, headH + 5.4, 7, 4.2, v.hair, BASE, 0.04));
  }

  // Rasterize far-to-near.
  parts.sort((a, c) => a.depth - c.depth);
  for (const part of parts) part.draw(buf);

  // Eyes last, only when the face points toward the camera.
  if (b.F.y > 0.12 && !pose.hideEyes) {
    const ex = P.px(headS, headF + 6);
    const ey = P.py(headS, headF + 6, headH + 0.5);
    const eyeSep = 2.6 * Math.max(0.4, Math.abs(b.S.x) / 1.42);
    putPx(buf, ex - eyeSep, ey, [42, 32, 26], BASE);
    putPx(buf, ex + eyeSep, ey, [42, 32, 26], BASE);
  }
}

// 1px outline: darkened local color, written into the layer of the pixel it
// outlines so tint-layer outlines tint along with the shirt.
function outlineBuf(buf) {
  const marks = [];
  for (let y = 0; y < FH; y++) {
    for (let x = 0; x < FW; x++) {
      const i = y * FW + x;
      if (buf.alpha[i] > 0) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= FW || ny >= FH) continue;
        const ni = ny * FW + nx;
        if (buf.alpha[ni] > 0) {
          const c = darken([buf.color[ni * 3], buf.color[ni * 3 + 1], buf.color[ni * 3 + 2]], 0.55);
          marks.push([x, y, c, buf.layer[ni]]);
          break;
        }
      }
    }
  }
  for (const [x, y, c, layer] of marks) putPx(buf, x, y, c, layer);
}

// --- Poses per animation ----------------------------------------------------

function walkPose(t) {
  const p = t * Math.PI * 2;
  return {
    legL: { fwd: Math.sin(p) * 3.6, lift: Math.max(0, Math.cos(p)) * 2 },
    legR: { fwd: -Math.sin(p) * 3.6, lift: Math.max(0, -Math.cos(p)) * 2 },
    armL: { s: -7.4, f: 1.2 - Math.sin(p) * 2.6, h: 13.5 },
    armR: { s: 7.4, f: 1.2 + Math.sin(p) * 2.6, h: 13.5 },
    bob: 0.5 * (1 + Math.cos(2 * p)) * 0.5,
  };
}

function idlePose(i) {
  return {
    bob: i === 0 ? 0 : 0.5,
    armL: { s: -7.5, f: 1.4, h: 13 },
    armR: { s: 7.5, f: 1.4, h: 13 },
  };
}

// Full swing: 8 frames. 0..5 = address→contact (driven by the pre-shot pause
// so CONTACT LANDS EXACTLY at ball launch); 6..7 = follow-through/finish
// (shown during early ball flight). Ball target is +S (character's left).
const SWING_KEYS = [
  { hands: { s: 6, f: 4.4, h: 12 }, club: { s: 7.4, f: 5, h: 0.8 }, lean: { s: 0, f: 1 } }, // address
  { hands: { s: 5.4, f: 4.4, h: 12 }, club: { s: 5.6, f: 5.2, h: 1.2 }, lean: { s: 0, f: 1 } }, // waggle
  { hands: { s: -2.5, f: 3.6, h: 15 }, club: { s: -9.5, f: 3.8, h: 8 }, lean: { s: -0.6, f: 0.8 } }, // takeaway
  { hands: { s: -5.5, f: 1.8, h: 23 }, club: { s: -10.5, f: 0.6, h: 33.5 }, lean: { s: -1.6, f: 0.4 } }, // top
  { hands: { s: 1.5, f: 4, h: 14 }, club: { s: -6, f: 4.4, h: 6 }, lean: { s: -0.3, f: 0.9 } }, // downswing
  { hands: { s: 6.4, f: 4.6, h: 12 }, club: { s: 7.8, f: 5, h: 0.8 }, lean: { s: 0.4, f: 1 } }, // contact
  { hands: { s: 5.6, f: 2, h: 21 }, club: { s: 10.5, f: 1, h: 29 }, lean: { s: 1.4, f: 0.2 } }, // follow
  { hands: { s: 3.5, f: 0.6, h: 23.5 }, club: { s: 6.5, f: -1.6, h: 33 }, lean: { s: 2, f: -0.2 } }, // finish
];

function swingPose(i) {
  const k = SWING_KEYS[i];
  return {
    legL: { fwd: 0.5 }, // slight open stance
    legR: { fwd: -0.5 },
    armL: { s: k.hands.s - 1.2, f: k.hands.f, h: k.hands.h },
    armR: { s: k.hands.s + 1.2, f: k.hands.f, h: k.hands.h },
    lean: k.lean,
    club: { hand: "R", head: k.club },
  };
}

// Putt: 4 frames. 0..2 = address→contact (pause-driven), 3 = hold.
const PUTT_KEYS = [
  { hands: { s: 4.8, f: 3.4, h: 11 }, club: { s: 5.4, f: 3.8, h: 0.8 } },
  { hands: { s: 3.4, f: 3.4, h: 11.4 }, club: { s: 1.6, f: 3.8, h: 1.6 } },
  { hands: { s: 5.6, f: 3.4, h: 11 }, club: { s: 7.4, f: 3.8, h: 1 } },
  { hands: { s: 6.2, f: 3.4, h: 11.2 }, club: { s: 8.6, f: 3.8, h: 1.8 } },
];

function puttPose(i) {
  const k = PUTT_KEYS[i];
  return {
    legL: { fwd: 0.3 },
    legR: { fwd: -0.3 },
    armL: { s: k.hands.s - 1.1, f: k.hands.f, h: k.hands.h },
    armR: { s: k.hands.s + 1.1, f: k.hands.f, h: k.hands.h },
    lean: { s: 0, f: 1.6 },
    headDrop: -1.5,
    club: { hand: "R", head: k.club },
  };
}

// Cheer: jump with both arms up (classic SimGolf hole-out).
function cheerPose(i) {
  const up = [0, 2.5, 4, 1][i];
  const armH = [24, 29, 31, 27][i];
  return {
    jump: up,
    legL: { fwd: 0, lift: up > 1 ? 1.5 : 0 },
    legR: { fwd: 0, lift: up > 1 ? 1.5 : 0 },
    armL: { s: -8.6, f: 0.5, h: armH },
    armR: { s: 8.6, f: 0.5, h: armH + (i === 2 ? 1 : 0) },
  };
}

// Frustrated: slump, then slam the club into the turf.
function madPose(i) {
  const keys = [
    { hands: { s: 6, f: 3, h: 12 }, club: { s: 6.6, f: 3.4, h: 1 }, drop: -2, bob: -0.5 },
    { hands: { s: 4, f: 1.5, h: 24 }, club: { s: 3, f: -1, h: 32 }, drop: -1, bob: 0 },
    { hands: { s: 5.5, f: 4.4, h: 9 }, club: { s: 6.4, f: 6.4, h: 0.4 }, drop: -3, bob: -1 },
    { hands: { s: 5.8, f: 4, h: 10 }, club: { s: 6.6, f: 5.6, h: 0.6 }, drop: -3, bob: -1 },
  ];
  const k = keys[i];
  return {
    legL: { fwd: 0.4, lift: i === 2 ? 0 : 0 },
    legR: { fwd: -0.4 },
    armL: { s: k.hands.s - 1.2, f: k.hands.f, h: k.hands.h },
    armR: { s: k.hands.s + 1.2, f: k.hands.f, h: k.hands.h },
    lean: { s: 0, f: 1.2 },
    headDrop: k.drop,
    bob: k.bob,
    club: { hand: "R", head: k.club },
  };
}

// --- Sheet assembly ---------------------------------------------------------

const ANIMS = [
  { name: "walk", cols: 6, rows: ROWS.map((r) => FACING_PSI[r]), pose: (c, cols) => walkPose(c / cols) },
  { name: "idle", cols: 2, rows: ROWS.map((r) => FACING_PSI[r]), pose: (c) => idlePose(c) },
  { name: "swing", cols: 8, rows: ROWS.map((r) => TARGET_PSI[r]), pose: (c) => swingPose(c) },
  { name: "putt", cols: 4, rows: ROWS.map((r) => TARGET_PSI[r]), pose: (c) => puttPose(c) },
  { name: "cheer", cols: 4, rows: [FACING_PSI.s], pose: (c) => cheerPose(c) },
  { name: "mad", cols: 4, rows: [FACING_PSI.s], pose: (c) => madPose(c) },
];

for (let v = 0; v < VARIANTS.length; v++) {
  for (const anim of ANIMS) {
    const rows = anim.rows.length;
    const base = new PNG({ width: anim.cols * FW, height: rows * FH });
    const tint = new PNG({ width: anim.cols * FW, height: rows * FH });
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < anim.cols; c++) {
        const buf = makeBuf();
        drawGolfer(buf, anim.rows[r], VARIANTS[v], anim.pose(c, anim.cols));
        outlineBuf(buf);
        // Split layers into the two sheets.
        for (let y = 0; y < FH; y++) {
          for (let x = 0; x < FW; x++) {
            const i = y * FW + x;
            if (!buf.alpha[i]) continue;
            const dst = buf.layer[i] === TINT ? tint : base;
            const di = ((r * FH + y) * dst.width + (c * FW + x)) << 2;
            dst.data[di] = buf.color[i * 3];
            dst.data[di + 1] = buf.color[i * 3 + 1];
            dst.data[di + 2] = buf.color[i * 3 + 2];
            dst.data[di + 3] = 255;
          }
        }
      }
    }
    const grid = `grid${anim.cols}x${rows}`;
    writeFileSync(path.join(OUT, `golfer${v}_${anim.name}.${grid}.png`), PNG.sync.write(base));
    writeFileSync(path.join(OUT, `golfer${v}_${anim.name}_t.${grid}.png`), PNG.sync.write(tint));
    console.log(`wrote golfer${v}_${anim.name}.${grid}.png (+tint)`);
  }
}
console.log("done");

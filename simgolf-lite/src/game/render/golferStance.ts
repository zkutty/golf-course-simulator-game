import { ELEVATION_STEP_YARDS } from "../rules/obstacleCollision";
import { golferActivityOwnerKey, type ActivityOwner } from "./golferActivity";
import { isoToWorld, tileCenterIso, type IsoRotation, type IsoPoint } from "./iso";
import { entityDepth } from "./objectPlacement";
import { NATURAL_GOLFER_DIRECTIONS, resolveNaturalGolferArt, type NaturalGolferArtIndex, type NaturalGolferDirection } from "./naturalGolferArt";

/** Model units relative to the feet; source padding/trim is deliberately absent. */
export const NATURAL_GOLFER_CONTACT_MODEL = Object.freeze({
  modelVersion: "natural-golfer-v1.0.0-candidate" as const,
  side: 7.6, forward: 12, height: 1, bodyUnitScale: 26 / 48,
  contactFrame: Object.freeze({ swing: 5, putt: 2 }),
});
export const GOLFER_STANCE_LIMITS = Object.freeze({
  maxRadiusTiles: .35, maxContactResidualPx: .5,
  maxAdjustmentSpeedPxPerSecond: 32,
  maxAdjustmentMs: Object.freeze({ swing: 800, putt: 400 }),
  surfaceSamplesPerCall: 2, retainedCallbacks: 0, clocks: 0, routes: 0,
});
const GLYPHS = Object.freeze({ centerY: -2, liveRadius: 2.2, controlledRadius: 2.8 });
const EPS = 1e-7;
export interface GolferStancePoint { readonly x: number; readonly y: number; readonly heightYards: number }
export interface GolferStanceIdentity {
  readonly owner: ActivityOwner;
  readonly authorityRevision: string;
  readonly surfaceRevision: string;
  /** Frozen WORLD direction vector from the retained launch, never screen facing. */
  readonly targetWorld: Readonly<IsoPoint>;
  readonly handedness: "right" | "left" | null;
  readonly modelVersion: string;
  readonly role: "swing" | "putt";
}
export interface GolferStanceSupportSample {
  readonly surfaceRevision: string;
  readonly heightYards: number;
  readonly inBounds: boolean;
  readonly supportedFootprint: boolean;
}
export interface GolferStanceGroundAuthority {
  readonly surfaceRevision: string;
  /**
   * Same ground authority as the retained ball. Coordinates are grid-vertex
   * space: entity x/y + .5, matching groundedGolferFrame/tileCenterIso.
   * supportedFootprint certifies the WHOLE stance footprint using the existing
   * walking support predicate (including water/building/decoration rejection).
   * This helper cannot replace that predicate or discover an alternative route.
   */
  readonly sampleFootprintAt: (centerX: number, centerY: number) => GolferStanceSupportSample;
}
export interface GolferStanceRequest {
  readonly identity: GolferStanceIdentity;
  readonly launch: GolferStancePoint;
  readonly artIndex: NaturalGolferArtIndex | null;
  readonly ground: GolferStanceGroundAuthority;
}
export interface GolferStanceBinding {
  readonly version: 1;
  readonly key: string;
  readonly ownerKey: string;
  readonly authorityRevision: string;
  readonly surfaceRevision: string;
  readonly targetWorld: Readonly<IsoPoint>;
  readonly targetBasisDegrees: number;
  readonly handedness: "right";
  readonly modelVersion: typeof NATURAL_GOLFER_CONTACT_MODEL.modelVersion;
  readonly role: "swing" | "putt";
  readonly launch: GolferStancePoint;
  readonly feet: GolferStancePoint;
  readonly deltaWorld: Readonly<IsoPoint>;
  readonly requiresArrivalProof: true;
}
export type GolferStanceReason = "invalid-identity" | "unsupported-handedness" | "unsupported-model" | "unsupported-role" | "invalid-launch" | "art-unavailable" | "invalid-ground-authority" | "surface-revision-mismatch" | "invalid-surface-sample" | "out-of-bounds" | "unsupported-footprint" | "launch-ground-mismatch" | "stance-radius-exceeded" | "contact-residual" | "tip-outside-ball-fill" | "invalid-binding" | "identity-invalidated" | "launch-invalidated" | "ground-invalidated" | "invalid-frame" | "arrival-proof-required" | "arrival-proof-incompatible" | "feet-not-at-stance" | "walking-authority-required";
export interface GolferStanceNeutral { readonly kind: "neutral"; readonly neutral: "non-gripping"; readonly reason: GolferStanceReason; readonly nextPlant: null }
export type GolferStanceCreation = { readonly kind: "candidate"; readonly binding: GolferStanceBinding; readonly requiresArrivalProof: true } | GolferStanceNeutral;

/** An upstream ZK-1417 certificate, not a route or timer created by this helper. */
export type GolferStanceArrivalProof = {
  readonly bindingKey: string; readonly validated: true;
} & (
  { readonly kind: "compatible-arrival" }
  | { readonly kind: "settled-initial" }
  | { readonly kind: "validated-adjustment"; readonly elapsedMs: number; readonly maxSpeedPxPerSecond: number; readonly supportedThroughout: true; readonly gaitExpressed: true; readonly withinExistingPreBackswingWindow: true }
);
/** Small caller-owned presentation token. It contains no clock or World reference. */
export interface GolferStancePlant {
  readonly version: 1;
  readonly bindingKey: string;
  readonly feet: GolferStancePoint;
  readonly arrivalKind: GolferStanceArrivalProof["kind"];
  readonly phase: "address" | "strike" | "watch";
}
export interface GolferStanceWalkingObservation {
  readonly ownerKey: string; readonly authorityRevision: string; readonly surfaceRevision: string;
  readonly segmentId: string; readonly routeRevision: string; readonly currentRouteRevision: string;
  readonly legal: true;
  readonly feet: GolferStancePoint;
}
export interface GolferStanceFrameRequest {
  readonly currentIdentity: GolferStanceIdentity;
  readonly launch: GolferStancePoint;
  readonly ground: GolferStanceGroundAuthority;
  readonly rotation: IsoRotation;
  readonly phase: "address" | "strike" | "watch" | "release";
  readonly actualFeet: GolferStancePoint | null;
  readonly arrival: GolferStanceArrivalProof | null;
  readonly previousPlant: GolferStancePlant | null;
  readonly walking: GolferStanceWalkingObservation | null;
  readonly acquisition: "continuous" | "reload" | "late-acquisition";
  readonly paused: boolean;
  readonly hidden: boolean;
}
export interface GolferStanceGeometry {
  /** Outer holder remains at authoritative launch B; all layers share localOffset. */
  readonly holderScreen: Readonly<IsoPoint>;
  readonly feetScreen: Readonly<IsoPoint>;
  readonly localOffset: Readonly<IsoPoint>;
  readonly depth: number;
  readonly targetDirection: NaturalGolferDirection;
  readonly bodyAngleDegrees: number;
  readonly contactFrame: number;
  readonly contactDatum: Readonly<IsoPoint>;
  readonly actualTip: Readonly<IsoPoint>;
  readonly residualPx: number;
  readonly insideLiveBallFill: boolean;
  readonly insideControlledBallFill: boolean;
}
export type GolferStanceFrame = GolferStanceNeutral
  | { readonly kind: "planted"; readonly phase: "address" | "strike" | "watch"; readonly geometry: GolferStanceGeometry; readonly nextPlant: GolferStancePlant }
  | { readonly kind: "released"; readonly neutral: "non-gripping"; readonly observedFeet: GolferStancePoint; readonly nextPlant: null };

// Weak brands reject copied/serialized candidates and forged planted carriers
// without retaining actors, callbacks, World objects or history in a registry.
const bindings = new WeakSet<GolferStanceBinding>();
const plants = new WeakMap<GolferStancePlant, GolferStanceBinding>();
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e6;
const label = (s: unknown): s is string => typeof s === "string" && s.length > 0 && s.length <= 256 && Array.from(s).every(c => c.charCodeAt(0) >= 32);
const point = (p: GolferStancePoint | null): p is GolferStancePoint => !!p && finite(p.x) && finite(p.y) && finite(p.heightYards);
const freezePoint = (p: GolferStancePoint): GolferStancePoint => Object.freeze({ x: p.x, y: p.y, heightYards: p.heightYards });
const freezeXY = (p: IsoPoint): Readonly<IsoPoint> => Object.freeze({ x: p.x, y: p.y });
const neutral = (reason: GolferStanceReason): GolferStanceNeutral => Object.freeze({ kind: "neutral", neutral: "non-gripping", reason, nextPlant: null });
const samePoint = (a: GolferStancePoint, b: GolferStancePoint): boolean => a.x === b.x && a.y === b.y && a.heightYards === b.heightYards;
const matchingFeet = (a: GolferStancePoint, b: GolferStancePoint): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= EPS && Math.abs(a.heightYards - b.heightYards) <= EPS;
function identityKey(identity: GolferStanceIdentity): string | null {
  const ownerKey = golferActivityOwnerKey(identity.owner);
  if (!ownerKey || identity.owner.shot === null || !label(identity.authorityRevision) || !label(identity.surfaceRevision)
    || !identity.targetWorld || !finite(identity.targetWorld.x) || !finite(identity.targetWorld.y)
    || Math.hypot(identity.targetWorld.x, identity.targetWorld.y) <= 0) return null;
  return ownerKey;
}
/** Positive-angle basis wins an exact halfway tie; camera rotation is absent. */
function targetBasis(target: Readonly<IsoPoint>): number {
  const turns = Math.atan2(target.y, target.x) / (Math.PI / 4);
  const lower = Math.floor(turns), fraction = turns - lower;
  // Trig/atan2 roundoff at authored halfway bearings must not flip a tie.
  const nearest = fraction < .5 - Number.EPSILON * 8 ? lower : lower + 1;
  return ((nearest % 8) + 8) % 8 * 45;
}
function view(basis: number, rotation: IsoRotation): { direction: NaturalGolferDirection; body: number } {
  const cameraBasis = (basis - rotation + 360) % 360;
  return { direction: NATURAL_GOLFER_DIRECTIONS[(cameraBasis / 45 + 7) % 8], body: (cameraBasis + 90) % 360 };
}
/** Shared authored WORLD basis for facing and targets; never quantize a screen vector. */
export function naturalGolferWorldView(direction: Readonly<IsoPoint> | null, rotation: IsoRotation): { readonly basisDegrees: number; readonly direction: NaturalGolferDirection; readonly octant: number } | null {
  if (!direction || !finite(direction.x) || !finite(direction.y) || Math.hypot(direction.x, direction.y) <= 0 || ![0, 90, 180, 270].includes(rotation)) return null;
  const basisDegrees = targetBasis(direction), authored = view(basisDegrees, rotation);
  return Object.freeze({ basisDegrees, direction: authored.direction, octant: ((basisDegrees - rotation + 360) / 45 + 1) % 8 });
}
function modelTip(bodyDegrees: number, height: number): IsoPoint {
  const { side, forward, bodyUnitScale: k } = NATURAL_GOLFER_CONTACT_MODEL;
  const a = bodyDegrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return { x: k * (side * (c + s) + forward * (c - s)), y: k * (side * (s - c) / 2 + forward * (c + s) / 2 - height) };
}
function surface(ground: GolferStanceGroundAuthority, p: GolferStancePoint, revision: string): GolferStanceSupportSample | GolferStanceNeutral {
  try {
    const s = ground.sampleFootprintAt(p.x + .5, p.y + .5);
    if (!s || !finite(s.heightYards) || typeof s.inBounds !== "boolean" || typeof s.supportedFootprint !== "boolean") return neutral("invalid-surface-sample");
    if (s.surfaceRevision !== revision) return neutral("surface-revision-mismatch");
    if (!s.inBounds) return neutral("out-of-bounds");
    if (!s.supportedFootprint) return neutral("unsupported-footprint");
    return Object.freeze({ surfaceRevision: s.surfaceRevision, heightYards: s.heightYards, inBounds: true, supportedFootprint: true });
  } catch { return neutral("invalid-surface-sample"); }
}
const isNeutral = (s: GolferStanceSupportSample | GolferStanceNeutral): s is GolferStanceNeutral => "kind" in s;
function validGround(ground: GolferStanceGroundAuthority, revision: string): boolean {
  return !!ground && ground.surfaceRevision === revision && typeof ground.sampleFootprintAt === "function";
}
function geometry(binding: GolferStanceBinding, rotation: IsoRotation): GolferStanceGeometry {
  const ball = binding.launch, feet = binding.feet, v = view(binding.targetBasisDegrees, rotation);
  const holderScreen = freezeXY(tileCenterIso(ball.x, ball.y, ball.heightYards / ELEVATION_STEP_YARDS, rotation));
  const feetScreen = freezeXY(tileCenterIso(feet.x, feet.y, feet.heightYards / ELEVATION_STEP_YARDS, rotation));
  const tip = modelTip(v.body, NATURAL_GOLFER_CONTACT_MODEL.height);
  const actualTip = freezeXY({ x: feetScreen.x + tip.x, y: feetScreen.y + tip.y });
  const contactDatum = freezeXY({ x: holderScreen.x, y: holderScreen.y - NATURAL_GOLFER_CONTACT_MODEL.bodyUnitScale });
  const glyphDistance = Math.hypot(actualTip.x - holderScreen.x, actualTip.y - holderScreen.y - GLYPHS.centerY);
  return Object.freeze({ holderScreen, feetScreen, localOffset: freezeXY({ x: feetScreen.x - holderScreen.x, y: feetScreen.y - holderScreen.y }),
    depth: Math.round(entityDepth(feet.x, feet.y, feet.heightYards / ELEVATION_STEP_YARDS, rotation) * 10) / 10,
    targetDirection: v.direction, bodyAngleDegrees: v.body, contactFrame: NATURAL_GOLFER_CONTACT_MODEL.contactFrame[binding.role], contactDatum, actualTip,
    residualPx: Math.hypot(actualTip.x - contactDatum.x, actualTip.y - contactDatum.y), insideLiveBallFill: glyphDistance <= GLYPHS.liveRadius, insideControlledBallFill: glyphDistance <= GLYPHS.controlledRadius });
}
function contactFailure(g: GolferStanceGeometry): GolferStanceNeutral | null {
  if (g.residualPx > GOLFER_STANCE_LIMITS.maxContactResidualPx + EPS) return neutral("contact-residual");
  return g.insideLiveBallFill && g.insideControlledBallFill ? null : neutral("tip-outside-ball-fill");
}

/** Candidate only: creation never asserts that walking feet already reached F. */
export function createGolferStanceBinding(request: GolferStanceRequest): GolferStanceCreation {
  const { identity: id, launch, ground, artIndex } = request, ownerKey = identityKey(id);
  if (!ownerKey) return neutral("invalid-identity");
  if (id.handedness !== "right") return neutral("unsupported-handedness");
  if (id.modelVersion !== NATURAL_GOLFER_CONTACT_MODEL.modelVersion) return neutral("unsupported-model");
  if (id.role !== "swing" && id.role !== "putt") return neutral("unsupported-role");
  if (!point(launch)) return neutral("invalid-launch");
  if (!validGround(ground, id.surfaceRevision)) return neutral("invalid-ground-authority");
  const basis = targetBasis(id.targetWorld), v = view(basis, 0);
  const art = resolveNaturalGolferArt(artIndex, { selection: { family: "natural-golfer-v1", identity: "primary-teal-cream-01" }, clip: id.role, direction: v.direction, col: NATURAL_GOLFER_CONTACT_MODEL.contactFrame[id.role], handedness: id.handedness });
  if (art.kind !== "frame" || !art.frame.contact || art.frame.directionRole !== "target" || art.frame.bodyUnitScale !== NATURAL_GOLFER_CONTACT_MODEL.bodyUnitScale || artIndex?.modelVersion !== id.modelVersion) return neutral("art-unavailable");
  const ballSurface = surface(ground, launch, id.surfaceRevision);
  if (isNeutral(ballSurface)) return ballSurface;
  if (Math.abs(ballSurface.heightYards - launch.heightYards) > EPS) return neutral("launch-ground-mismatch");
  const groundDelta = modelTip(v.body, 0);
  const deltaWorld = isoToWorld(groundDelta.x, groundDelta.y);
  if (Math.hypot(deltaWorld.x, deltaWorld.y) > GOLFER_STANCE_LIMITS.maxRadiusTiles) return neutral("stance-radius-exceeded");
  const feetXY = { x: launch.x - deltaWorld.x, y: launch.y - deltaWorld.y, heightYards: launch.heightYards };
  const feetSurface = surface(ground, feetXY, id.surfaceRevision);
  if (isNeutral(feetSurface)) return feetSurface;
  const key = JSON.stringify([ownerKey, id.authorityRevision, id.surfaceRevision, launch.x, launch.y, launch.heightYards, id.targetWorld.x, id.targetWorld.y, id.handedness, id.modelVersion, id.role]);
  const binding: GolferStanceBinding = Object.freeze({ version: 1, key, ownerKey, authorityRevision: id.authorityRevision, surfaceRevision: id.surfaceRevision,
    targetWorld: freezeXY(id.targetWorld), targetBasisDegrees: basis, handedness: "right", modelVersion: NATURAL_GOLFER_CONTACT_MODEL.modelVersion, role: id.role,
    launch: freezePoint(launch), feet: freezePoint({ ...feetXY, heightYards: feetSurface.heightYards }), deltaWorld: freezeXY(deltaWorld), requiresArrivalProof: true });
  const failure = contactFailure(geometry(binding, 0));
  if (failure) return failure;
  bindings.add(binding);
  return Object.freeze({ kind: "candidate", binding, requiresArrivalProof: true });
}
function sameIdentity(binding: GolferStanceBinding, id: GolferStanceIdentity): boolean {
  return identityKey(id) === binding.ownerKey && id.authorityRevision === binding.authorityRevision && id.surfaceRevision === binding.surfaceRevision
    && id.targetWorld.x === binding.targetWorld.x && id.targetWorld.y === binding.targetWorld.y && id.handedness === binding.handedness && id.modelVersion === binding.modelVersion && id.role === binding.role;
}
function arrivalValid(binding: GolferStanceBinding, f: GolferStanceFrameRequest): boolean {
  const p = f.arrival;
  if (!p || p.validated !== true || p.bindingKey !== binding.key) return false;
  if (p.kind === "settled-initial") return f.acquisition === "reload" || f.acquisition === "late-acquisition";
  if (f.acquisition !== "continuous") return false;
  if (p.kind === "compatible-arrival") return true;
  return p.kind === "validated-adjustment" && finite(p.elapsedMs) && p.elapsedMs >= 0 && p.elapsedMs <= GOLFER_STANCE_LIMITS.maxAdjustmentMs[binding.role]
    && finite(p.maxSpeedPxPerSecond) && p.maxSpeedPxPerSecond >= 0 && p.maxSpeedPxPerSecond <= GOLFER_STANCE_LIMITS.maxAdjustmentSpeedPxPerSecond
    && p.supportedThroughout === true && p.gaitExpressed === true && p.withinExistingPreBackswingWindow === true;
}

/** Validate current identity/surface BEFORE publishing even a paused/hidden hold. */
export function sampleGolferStance(binding: GolferStanceBinding, f: GolferStanceFrameRequest): GolferStanceFrame {
  if (!bindings.has(binding)) return neutral("invalid-binding");
  if (!sameIdentity(binding, f.currentIdentity)) return neutral("identity-invalidated");
  if (!point(f.launch) || !samePoint(binding.launch, f.launch)) return neutral("launch-invalidated");
  if (!validGround(f.ground, binding.surfaceRevision)) return neutral("invalid-ground-authority");
  if (![0, 90, 180, 270].includes(f.rotation) || !["address", "strike", "watch", "release"].includes(f.phase)
    || !["continuous", "reload", "late-acquisition"].includes(f.acquisition) || typeof f.paused !== "boolean" || typeof f.hidden !== "boolean") return neutral("invalid-frame");
  const ballSurface = surface(f.ground, binding.launch, binding.surfaceRevision);
  if (isNeutral(ballSurface)) return ballSurface;
  const feetSurface = surface(f.ground, binding.feet, binding.surfaceRevision);
  if (isNeutral(feetSurface)) return feetSurface;
  if (Math.abs(ballSurface.heightYards - binding.launch.heightYards) > EPS || Math.abs(feetSurface.heightYards - binding.feet.heightYards) > EPS) return neutral("ground-invalidated");
  const held = f.acquisition === "continuous" && !!f.previousPlant && plants.get(f.previousPlant) === binding;
  if (f.phase === "release" && !(held && (f.paused || f.hidden))) {
    const w = f.walking;
    if (!held || f.paused || f.hidden || !w || w.legal !== true || w.ownerKey !== binding.ownerKey || w.authorityRevision !== binding.authorityRevision || w.surfaceRevision !== binding.surfaceRevision
      || !label(w.segmentId) || !label(w.routeRevision) || w.routeRevision !== w.currentRouteRevision || !point(w.feet) || !point(f.actualFeet) || !samePoint(w.feet, f.actualFeet)) return neutral("walking-authority-required");
    return Object.freeze({ kind: "released", neutral: "non-gripping", observedFeet: freezePoint(w.feet), nextPlant: null });
  }
  if (!held && !f.arrival) return neutral("arrival-proof-required");
  if (!held && !arrivalValid(binding, f)) return neutral("arrival-proof-incompatible");
  // A hidden/paused valid plant may lack a new foot observation; acquisition may not.
  if (!(held && (f.paused || f.hidden) && f.actualFeet === null) && (!point(f.actualFeet) || !matchingFeet(f.actualFeet, binding.feet))) return neutral("feet-not-at-stance");
  const g = geometry(binding, f.rotation), failure = contactFailure(g);
  if (failure) return failure;
  const phase = held && (f.paused || f.hidden) ? f.previousPlant!.phase : f.phase;
  if (phase === "release") return neutral("walking-authority-required");
  const plant: GolferStancePlant = held && f.previousPlant!.phase === phase ? f.previousPlant! : Object.freeze({ version: 1, bindingKey: binding.key, feet: binding.feet, arrivalKind: held ? f.previousPlant!.arrivalKind : f.arrival!.kind, phase });
  plants.set(plant, binding);
  return Object.freeze({ kind: "planted", phase, geometry: g, nextPlant: plant });
}

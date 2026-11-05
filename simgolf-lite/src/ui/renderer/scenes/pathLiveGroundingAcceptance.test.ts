import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import * as PIXI from "pixi.js";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../../../game/models/defaults";
import type { Course, Point, Terrain } from "../../../game/models/types";
import { translateSurfaceIntent } from "../../../game/models/surfaceIntent";
import { courseWithEffectiveSurfaces } from "../../../game/conditions/surfaceCare";
import type { Golfer, GolferRenderData } from "../../../game/live/types";
import { mobilityRenderUnits } from "../../../game/m51/mobilityRender";
import { advanceGolfer } from "../../../game/live/golfer";
import { createLiveState, liveRenderData } from "../../../game/live/simulation";
import { findWalkPath } from "../../../game/live/walkPath";
import { TimedItineraryBuilder } from "../../../game/m51/timedItinerary";
import { reserveGroupMobility, reapplyGroupMobility } from "../../../game/m51/operations";
import type { MobilityMode } from "../../../game/m51/types";
import * as observedRouter from "../../../game/m51/travelRouter";
import { createPathWalkingRouter } from "../../../game/paths/pathMovementAdapter";
import { buildContinuousPathPlan, type ContinuousPathPlan } from "../../../game/paths/continuousPathPlan";
import { authoredPathFixture } from "../../../game/testing/continuousPathFixtures";
import { buildVisualHeightfield, createLandscapeComponentCache, sampleLandscapeSurfaceHeight, sampleVisualHeight, type VisualHeightfield } from "../../../game/render/landscapeGeometry";
import { isMaintained } from "../../../game/render/materialFields";
import { worldToIso, type IsoRotation } from "../../../game/render/iso";
import { GOLFER_FEET_Y, GOLFER_FRAME_H } from "../../../game/render/golferSprites";
import { GOLFER_CONTACT_SHADOW } from "../../../game/render/golferGrounding";
import type { RenderSnapshot } from "../RenderSnapshot";
import { findRenderedPathContact, renderedContactMatches, renderedContactResidual, type RenderedPathSurface } from "../testing/renderedPathContact";
import { buildPathMaterialScenePlan, continuousPathGroundHeight, createContinuousPathContactSampler, pathMaterialLayerMesh } from "./pathMaterialScene";
import { createLiveEntitiesSceneSystem } from "./liveEntitiesScene";
import { createMobilityEntitiesSceneSystem } from "./mobilityEntitiesScene";

// This executes frozen Stage input/callback bodies, not a mirrored height rule.
// The independent oracle never calls these bodies or any height sampler.
const stageSource = readFileSync(new URL("../../PixiStage.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("PixiStage.tsx", stageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function factory<T>(expression: string, scope: Record<string, unknown>): T {
  const js = ts.transpileModule(`const value = (${expression});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(scope), `${js}\nreturn value;`)(...Object.values(scope)) as T;
}
function stageFunction<T>(name: string, scope: Record<string, unknown>): T {
  const node = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!node) throw new Error(`A1_SETUP Stage function missing: ${name}`);
  return factory<T>(node.getText(parsed), scope);
}
function stageArrow<T>(name: string, contains: string, scope: Record<string, unknown>): T {
  const candidates: ts.ArrowFunction[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === name && node.initializer) {
      const arrow = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer;
      if (arrow && ts.isArrowFunction(arrow) && arrow.getText(parsed).includes(contains)) candidates.push(arrow);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  if (candidates.length !== 1) throw new Error(`A1_SETUP Stage arrow ${name}: ${candidates.length} candidates`);
  return factory<T>(candidates[0].getText(parsed), scope);
}
const from = { x: 14, y: 9 }, to = { x: 25, y: 11 };
function fixture(): Course {
  const shared = authoredPathFixture(), width = 60, height = 24;
  const surfaceIntent = translateSurfaceIntent(shared.surfaceIntent, shared.width, shared.height, width, height, { x: 12, y: 6 });
  const tiles: Terrain[] = Array(width * height).fill("water");
  for (const cell of surfaceIntent!.features[0].coverage) tiles[cell] = "path";
  return { ...DEFAULT_COURSE, name: "A1 real M4 saved S", width, height, tiles, surfaceIntent,
    // Integer, bounded grade with cardinal/diagonal neighbor differences <=1.
    elevations: Array.from({ length: width * height }, (_, cell) => {
      const x = cell % width - 12, y = Math.floor(cell / width) - 6;
      return Math.max(0, Math.round(2 + .04 * x + .06 * y + .6 * Math.sin(x * .45) * Math.cos(y * .35)));
    }),
    estate: undefined, property: undefined, obstacles: [], decorations: [],
    holes: [{ id: "hole-1", tee: from, green: to, parMode: "AUTO", name: "Actual sloped S" }],
    layouts: [{ id: "course-primary", name: "A1", draftHoleIds: ["hole-1"], publishedHoleIds: ["hole-1"], roundLength: 9, state: "open", greenFee: 65, legacyPartial: true }],
    buildings: [{ id: "rental", type: "cart_rental", x: 2, y: 2, tier: 2, price: 20 }],
    m51: { version: 3, cartRentals: { rental: { buildingId: "rental", tier: 2, products: {
      pushcart: { id: "rental:pushcart", courseId: "course-primary", buildingId: "rental", mode: "pushcart", name: "Pushcart", price: 9, enabled: true },
      riding_cart: { id: "rental:riding_cart", courseId: "course-primary", buildingId: "rental", mode: "riding_cart", name: "Riding cart", price: 20, enabled: true },
    } } }, fleet: {
      "cart-1": { id: "cart-1", courseId: "course-primary", buildingId: "rental", productId: "rental:riding_cart", mode: "riding_cart", seats: 2, state: "available", condition: 1, uses: 0, wear: 0 },
      "push-1": { id: "push-1", courseId: "course-primary", buildingId: "rental", productId: "rental:pushcart", mode: "pushcart", seats: 1, state: "available", condition: 1, uses: 0, wear: 0 },
    }, settledAssignmentIds: [] },
  };
}
function member(): Golfer {
  return { id: 1, name: "A1", archetype: "senior", courseId: "course-primary", courseName: "A1",
    personality: { skill: .55, consistency: .6, patience: .45, spendPropensity: 1, prefs: { difficulty: 0, scenery: 0, price: 1 }, pacePreference: .8 },
    color: "#fff", segments: [], segIndex: 0, segElapsed: 0, pos: { ...from }, ball: null,
    holePar: [4], holeStrokes: [4], scoredHoles: 0, currentHole: -1, strokes: 0, scoreToPar: 0,
    mood: .7, thought: null, thoughtUntil: 0, finished: false, spent: 65, wallet: 80,
    purchasedSegmentIndexes: [], groupId: "A1-saved-S", groupStartedAt: 20, pacePreference: .8, completionStatus: "completed" };
}
function itinerary(course: Course, adapted: boolean, destination = to) {
  const builder = new TimedItineraryBuilder({ course, cursor: from, personality: member().personality, rng: () => .5,
    route: adapted ? createPathWalkingRouter(course, new Map()) : (a, b) => findWalkPath(course, a, b) });
  builder.appendWalk(from, destination, 0);
  return builder.segments.map(segment => ({ ...segment, holeId: "hole-1" }));
}
function stateFor(course: Course, golfer: Golfer) {
  const state = createLiveState(course, { ...DEFAULT_WORLD, runSeed: 5151 }, 0);
  state.arrivals = []; state.nextArrivalIdx = 0; state.groups = []; state.golfers = [golfer]; state.weather = undefined;
  return state;
}
function economicState(golfer: Golfer) {
  return { actual: golfer.mobilityActualTravelMinutes, fallback: golfer.mobilityWalkingFallbackMinutes,
    offpath: golfer.mobilityOffPathTiles, wallet: golfer.wallet, spent: golfer.spent };
}
function prepare(course: Course, mode: MobilityMode, routeReceipts: unknown[], destination = to) {
  const old = member(), current = member(); old.segments = itinerary(course, false, destination); current.segments = itinerary(course, true, destination);
  const baseline = stateFor(course, old), state = stateFor(course, current);
  const original = observedRouter.planTimedMobilityLeg; let phase = "baseline";
  const calls: Record<string, unknown[]> = { baseline: [], actual: [], "baseline-reapply": [], reapply: [] };
  const spy = vi.spyOn(observedRouter, "planTimedMobilityLeg").mockImplementation((request, cache) => {
    const leg = original(request, cache);
    calls[phase].push({ from: request.from, to: request.to, mode: request.mode,
      result: leg && { cells: leg.cells, cost: leg.cost, minutes: leg.minutes, expansions: leg.expansions,
        resolvedMode: leg.resolvedMode, fallback: leg.fallback } });
    return leg;
  });
  try {
    const before = reserveGroupMobility(baseline, course, [old]); phase = "actual";
    const after = reserveGroupMobility(state, course, [current]);
    expect(after.selection.mode).toBe(mode); expect(after.assignment.status).toBe("active");
    expect(after.selection.status).toBe("confirmed"); expect(after.selection.perGolferFee).toBe(mode === "walk" ? 0 : mode === "pushcart" ? 9 : 20);
    expect(after.cashDelta).toBe(before.cashDelta); expect(after.concessionTransactions).toEqual(before.concessionTransactions);
    expect(calls.actual).toEqual(calls.baseline);
    const equalEconomics = () => {
      const a = economicState(current), b = economicState(old);
      if (mode === "walk") expect(a.actual).toBeCloseTo(b.actual!, 12); else expect(a.actual).toBe(b.actual);
      expect({ ...a, actual: undefined }).toEqual({ ...b, actual: undefined });
    };
    equalEconomics(); const transactions = JSON.stringify(state.m51!.transactions);
    phase = "baseline-reapply"; old.segments = itinerary(course, false, destination); reapplyGroupMobility(baseline, course, old);
    phase = "reapply"; current.segments = itinerary(course, true, destination); reapplyGroupMobility(state, course, current);
    equalEconomics(); expect(calls.reapply).toEqual(calls["baseline-reapply"]); expect(JSON.stringify(state.m51!.transactions)).toBe(transactions);
    expect(current.segments.some(segment => segment.kind === "walk" && segment.mobility?.resolvedMode === mode)).toBe(true);
    routeReceipts.push({ mode, selection: after.selection, assignment: after.assignment, economics: economicState(current), calls });
    return { state, current, assignment: after.assignment };
  } finally { spy.mockRestore(); }
}
function renderInputs(course: Course, quality: "low" | "medium" | "high", plan: ContinuousPathPlan) {
  const effective = stageFunction<(...args: unknown[]) => Terrain[]>("effectiveSurfaceTilesForRenderer", { courseWithEffectiveSurfaces });
  const effectiveTiles = effective(course.tiles, course.width, course.height, course.surfaceCare, course.surfaceIntent, course.estate);
  const buildField = stageFunction<(...args: unknown[]) => VisualHeightfield>("visualHeightfieldForRenderer", { buildVisualHeightfield });
  const visualHeightfield = buildField(course.tiles, course.elevations, course.width, course.height, course.buildings, course.property?.assets, course.theme);
  const options = stageFunction<(quality: string) => { cornerRadius: number; cornerSegments: number }>("landscapeOptionsForQuality", {});
  const components = createLandscapeComponentCache().update(effectiveTiles, course.width, course.height, options(quality)).components;
  const byCell: Array<typeof components[number] | null> = Array(effectiveTiles.length).fill(null);
  for (const component of components) for (const cell of component.cells) byCell[cell] = component;
  const pathScenePlan = buildPathMaterialScenePlan(plan, quality);
  const pathContactHeightAt = stageArrow<( ) => (x: number, y: number) => number | null>("pathContactHeightAt", "createContinuousPathContactSampler", {
    course, pathScenePlan, visualHeightfield, createContinuousPathContactSampler, sampleVisualHeight,
  })();
  const surfaceHeightAt = stageArrow<(x: number, y: number) => number>("surfaceHeightAt", "continuousPathGroundHeight", {
    course, effectiveTiles, props: { graphicsQuality: quality }, pathScenePlan, pathContactHeightAt, visualHeightfield,
    landscapeComponentByCell: byCell, isMaintained, continuousPathGroundHeight, sampleVisualHeight, sampleLandscapeSurfaceHeight,
  });
  return { effectiveTiles, visualHeightfield, surfaceHeightAt };
}
function meshSurface(plan: ContinuousPathPlan, field: VisualHeightfield, rotation: IsoRotation) {
  const project = stageArrow<(point: Point) => Point>("project", "sampleVisualHeight(heightfield", { worldToIso, sampleVisualHeight, heightfield: field, rotation });
  const core = plan.layers.find(layer => layer.role === "core")!;
  const data = pathMaterialLayerMesh(core, project);
  const geometry = new PIXI.MeshGeometry({ positions: data.positions, uvs: data.uvs, indices: data.indices });
  const positions = geometry.getBuffer("aPosition").data, indices = geometry.getIndex().data;
  if (!(positions instanceof Float32Array) || !(indices instanceof Uint32Array)) throw new Error("A1_SETUP final GPU geometry buffer type changed");
  return { geometry, surface: { worldPositions: core.positions, positions, indices } satisfies RenderedPathSurface };
}
function scenePair(course: Course, inputs: ReturnType<typeof renderInputs>, quality: "low" | "medium" | "high", rotation: IsoRotation) {
  const world = new PIXI.Container(), objects = new PIXI.Container(), decals = new PIXI.Container(), fx = new PIXI.Container(), overlay = new PIXI.Container();
  world.addChild(objects, decals, fx, overlay);
  const live = createLiveEntitiesSceneSystem({ objects, terrainDecals: decals, fx, screenOverlay: overlay }, {
    atlasReady: () => true, golferFrame: () => PIXI.Texture.WHITE,
    createSprite: () => new PIXI.Sprite(PIXI.Texture.WHITE), createText: () => new PIXI.Sprite(PIXI.Texture.WHITE) as unknown as PIXI.Text,
  });
  const mobility = createMobilityEntitiesSceneSystem(objects);
  const snapshot: RenderSnapshot = { course, effectiveTiles: inputs.effectiveTiles, surfaceHeightAt: inputs.surfaceHeightAt, rotation, graphicsQuality: quality,
    obstacles: course.obstacles, holes: course.holes, draftTee: null, draftGreen: null, colorVision: "standard", reducedMotion: false,
    animationsEnabled: true, showObstacles: true, atlasRevision: 1, surveyMode: false, worldSeed: 5151,
    revisions: { atmosphere: 1, surfaceCare: 1, structuresProps: 1, playerProCollection: 1, naturalProps: 1,
      architectureOverlay: 1, overlaysDiagnostics: 1, estateSurvey: 1, liveEntities: 1, mobilityEntities: 1 },
  };
  live.create!(snapshot); mobility.create!(snapshot);
  return { world, objects, live, mobility, snapshot, destroy: () => { live.destroy!(); mobility.destroy!(); world.destroy({ children: true }); } };
}
const cullBounds = { left: -1e6, top: -1e6, right: 1e6, bottom: 1e6 };
function tick(pair: ReturnType<typeof scenePair>, state: ReturnType<typeof stateFor>, nowMs: number) {
  const golfers = liveRenderData(state);
  pair.live.tickEffects(nowMs, true);
  pair.live.tickEntities({ nowMs, animationsEnabled: true, golfers, cullBounds,
    worldPointToScreen: (x, y, elevation = 0) => worldToIso(x, y, elevation, pair.snapshot.rotation),
    followCamera: () => undefined, startleAtmosphere: () => undefined,
    tickMobilityEntities: () => pair.mobility.tick({ golfers, cullBounds }) });
  return golfers;
}
function movingVehicle(pair: ReturnType<typeof scenePair>, id: string | undefined, golfers: readonly GolferRenderData[]) {
  // The product can retain a parked graphic with the same ID after riders
  // disappear. An actual active render unit with real riders is mandatory.
  const unit = mobilityRenderUnits(pair.snapshot.course, golfers).find(unit => unit.id === id);
  return id && unit && (unit.state === "riding_cart" || unit.state === "pushcart") && unit.riderIds.length > 0
    ? pair.objects.children.find(child => child.label === `mobility-entity:${id}`) : undefined;
}
function oracleControls() {
  const surface: RenderedPathSurface = { worldPositions: [0, 0, 1, 0, 1, 1], positions: new Float32Array([0, 0, 32, 16, 0, 32]), indices: new Uint32Array([0, 1, 2]) };
  const contact = findRenderedPathContact(surface, { x: .75, y: .25 }); if (!contact) throw new Error("A1_SETUP oracle control not interior");
  expect(renderedContactMatches(contact, contact.expected)).toBe(true);
  expect(renderedContactMatches(contact, { x: contact.expected.x, y: contact.expected.y + 1 })).toBe(false);
  expect(renderedContactMatches(contact, null)).toBe(false);
  const distorted = { ...surface, positions: surface.positions.slice() }; distorted.positions[2] += 1;
  expect(renderedContactMatches(findRenderedPathContact(distorted, { x: .75, y: .25 })!, contact.expected)).toBe(false);
}

it("A1 proves actual M4 moving actors against final Float32 path triangle interiors", () => {
  const receipt: { status: string; controls: string[]; routes: unknown[]; samples: unknown[]; unresolvedAcceptance: string[]; failure?: unknown } = { status: "running", controls: [], routes: [], samples: [], unresolvedAcceptance: ["Separate real flat production-field control executes only after the principal nonaffine matrix passes."] };
  const output = process.env.JOINS_A1_RECEIPT_PATH ?? "/private/tmp/coursecraft-followthrough-20261105/JOINS-A2/contact-principal-receipt.json";
  let stage = "oracle-controls";
  try {
    oracleControls(); receipt.controls.push("independent-offset/omission/buffer-perturbation");
    const base = fixture(), plan = buildContinuousPathPlan(base);
    expect(plan.edges).toHaveLength(1); expect(plan.edges[0].source).toBe("intent");
    expect(plan.edges[0].width).toBeCloseTo(.9);
    for (let y = 1; y < base.height; y++) for (let x = 1; x < base.width; x++) {
      const i = y * base.width + x;
      expect(Math.abs(base.elevations[i] - base.elevations[i - base.width - 1])).toBeLessThanOrEqual(1);
    }
    let controlsDone = false;
    for (const mode of ["riding_cart", "pushcart", "walk"] as const) {
      const course = { ...base, m51: structuredClone(base.m51) };
      course.m51!.cartRentals.rental.products.riding_cart.enabled = mode === "riding_cart";
      course.m51!.cartRentals.rental.products.pushcart.enabled = mode !== "walk";
      stage = `prepare-${mode}`;
      const { state, current, assignment } = prepare(course, mode, receipt.routes);
      for (const quality of ["low", "high", "medium"] as const) for (const rotation of [0, 90, 180, 270] as const) {
        stage = `${mode}-${quality}-${rotation}`;
        const inputs = renderInputs(course, quality, plan), mesh = meshSurface(plan, inputs.visualHeightfield, rotation);
        const pair = scenePair(course, inputs, quality, rotation);
        const moving = { ...current, pos: { ...from }, segIndex: 0, segElapsed: 0, finished: false }; state.golfers = [moving];
        const business = () => JSON.stringify({ course, mobility: state.m51, economics: economicState(moving) });
        const invariant = business(); let elapsed = 0;
        try {
          let clock = 0;
          const candidates = current.segments.flatMap((segment, index) => {
            const start = clock; clock += segment.dur;
            return segment.kind === "walk" ? [.23, .51, .79].flatMap(t => {
              const q = { x: segment.from.x + (segment.to.x - segment.from.x) * t + .5, y: segment.from.y + (segment.to.y - segment.from.y) * t + .5 };
              return findRenderedPathContact(mesh.surface, q) ? [{ time: start + segment.dur * t, index, t }] : [];
            }) : [];
          });
          if (candidates.length < 3) throw new Error("A1_SETUP no genuine triangle-interior movement samples");
          const selected = candidates.length <= 24 ? candidates : Array.from({ length: 24 }, (_, i) => candidates[Math.floor(i * (candidates.length - 1) / 23)]);
          const deltas: number[] = [];
          for (const sample of selected) {
            advanceGolfer(moving, sample.time - elapsed, course.condition); elapsed = sample.time;
            const rows = liveRenderData(state), row = rows[0];
            expect(row.segKind).toBe("walk"); expect(row.segT).toBeGreaterThan(0); expect(row.segT).toBeLessThan(1);
            expect(moving.segments[moving.segIndex].mobility?.resolvedMode, "A1_SETUP sampled segment must retain the actual requested travel mode").toBe(mode);
            const q = { x: row.x + .5, y: row.y + .5 }, contact = findRenderedPathContact(mesh.surface, q);
            if (!contact) throw new Error("A1_SETUP actual moving point is not a final triangle interior");
            const beforeTick = business(); tick(pair, state, 2000 + receipt.samples.length * 16);
            expect(business()).toBe(beforeTick); expect(business()).toBe(invariant);
            const actual = pair.live.golferGrounding(1, rows);
            if (!actual) throw new Error("A1_SETUP missing actual golfer scene holder");
            expect(actual.feet).toEqual({ x: 0, y: 0, anchorY: GOLFER_FEET_Y / GOLFER_FRAME_H });
            expect(actual.shadow).toMatchObject({ label: "golfer-contact-shadow", x: GOLFER_CONTACT_SHADOW.x, y: GOLFER_CONTACT_SHADOW.y });
            expect(actual.poolCount).toBe(1);
            const vehicle = mode === "walk" ? undefined : movingVehicle(pair, assignment.fleetUnitIds[0], rows);
            if (mode !== "walk" && (!vehicle || row.mobilityUnitId !== assignment.fleetUnitIds[0] || row.mobilityUnitMode !== mode)) throw new Error("A1_SETUP missing or substituted real moving rental unit");
            const samplerPoint = worldToIso(q.x, q.y, inputs.surfaceHeightAt(q.x, q.y), rotation);
            // Retain nonaffinity evidence from the unchanged ORIGINAL field,
            // separately from the corrected contact callback residual.
            const directBilinearPoint = worldToIso(q.x, q.y, sampleVisualHeight(inputs.visualHeightfield, q.x, q.y), rotation);
            const discriminator = renderedContactResidual(contact, directBilinearPoint); deltas.push(discriminator);
            const record = { stage, sample, actualSegment: moving.segments[moving.segIndex], legacy: { x: row.x, y: row.y }, q,
              actualMode: row.mobilityUnitMode, actualUnitId: row.mobilityUnitId, contact,
              golfer: { holder: actual.holder, feet: actual.feet, shadow: actual.shadow }, vehicle: vehicle && { x: vehicle.position.x, y: vehicle.position.y },
              golferResidualPx: renderedContactResidual(contact, actual.holder), cartResidualPx: vehicle ? renderedContactResidual(contact, vehicle.position, 2) : null,
              directBilinearTriangleDiscriminatorPx: discriminator, correctedSamplerResidualPx: renderedContactResidual(contact, samplerPoint) };
            receipt.samples.push(record);
            if (!renderedContactMatches(contact, actual.holder) || (vehicle && !renderedContactMatches(contact, vehicle.position, 2))) {
              receipt.status = "real-contact-red"; receipt.failure = record;
              throw new Error(`A1_REAL_CONTACT_MISMATCH ${JSON.stringify(record)}`);
            }
            // Run actual-scene negative controls only AFTER this exact actual
            // sample passed. No synthetic positive or affine-field pass.
            if (!controlsDone && vehicle) {
              expect(renderedContactMatches(contact, { x: actual.holder.x, y: actual.holder.y + 1 })).toBe(false);
              expect(renderedContactMatches(contact, vehicle.position, 0)).toBe(false);
              const wrongRotation = meshSurface(plan, inputs.visualHeightfield, 90);
              try { expect(renderedContactMatches(findRenderedPathContact(wrongRotation.surface, q)!, actual.holder)).toBe(false); }
              finally { wrongRotation.geometry.destroy(); }
              pair.mobility.tick({ golfers: [], cullBounds });
              const parked = pair.objects.children.find(child => child.label === `mobility-entity:${assignment.fleetUnitIds[0]}`);
              const omitted = movingVehicle(pair, assignment.fleetUnitIds[0], []);
              expect(omitted).toBeUndefined(); expect(renderedContactMatches(contact, omitted?.position, 2)).toBe(false);
              receipt.samples.push({ control: "actual-moving-unit-omitted", stage, activeUnits: mobilityRenderUnits(course, []),
                sameIdParkedGraphic: parked ? { x: parked.position.x, y: parked.position.y } : null });
              tick(pair, state, 2001 + receipt.samples.length * 16);
              const restored = movingVehicle(pair, assignment.fleetUnitIds[0], rows);
              expect(restored, "A1_SETUP actual moving rental unit must return after negative control").toBeDefined();
              expect(renderedContactMatches(contact, restored!.position, 2)).toBe(true);
              expect(business()).toBe(invariant);
              receipt.controls.push("actual-passing-sample-offset-rejected", "actual-moving-cart-omission-rejected", "wrong-rotation-rejected", "wrong-cart-offset-rejected");
              controlsDone = true;
            }
          }
          if (!deltas.some(delta => delta > 1e-6)) throw new Error("A1_SETUP real product field supplied no non-affine triangle-interior discriminator");
        } finally { pair.destroy(); mesh.geometry.destroy(); }
      }
    }
    receipt.status = "non-affine-contact-passed-flat-product-control-separate";
  } catch (error) {
    if (receipt.status !== "real-contact-red") { receipt.status = "setup-or-control-red"; receipt.failure = { stage, error: String(error) }; }
    throw error;
  } finally {
    mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(receipt, null, 2));
    vi.restoreAllMocks();
  }
});


it("A2 separately proves real M4 contact on an actual production flat field", () => {
  const output = process.env.JOINS_A2_FLAT_RECEIPT_PATH ?? "/private/tmp/coursecraft-followthrough-20261105/JOINS-A2/contact-flat-receipt.json";
  const receipt: { status: string; routes: unknown[]; sample?: unknown; failure?: string } = { status: "running", routes: [] };
  try {
    // A real Course input, not a synthetic/injected heightfield. Water flat
    // locks surround every corner of this one-cell-wide PATH row.
    const course = fixture(), destination = { x: 25, y: 9 };
    course.name = "A2 production water-locked flat path";
    course.tiles = Array<Terrain>(course.width * course.height).fill("water");
    for (let x = 14; x <= 25; x++) course.tiles[9 * course.width + x] = "path";
    course.elevations = Array(course.tiles.length).fill(3); course.surfaceIntent = undefined;
    course.holes = [{ ...course.holes[0], green: destination }];
    const plan = buildContinuousPathPlan(course), inputs = renderInputs(course, "low", plan), mesh = meshSurface(plan, inputs.visualHeightfield, 0);
    const { state, current, assignment } = prepare(course, "riding_cart", receipt.routes, destination);
    const pair = scenePair(course, inputs, "low", 0);
    const moving = { ...current, pos: { ...from }, segIndex: 0, segElapsed: 0, finished: false }; state.golfers = [moving];
    try {
      let clock = 0;
      const candidates = current.segments.flatMap((segment, index) => {
        const start = clock; clock += segment.dur;
        if (segment.kind !== "walk") return [];
        const t = .23, q = { x: segment.from.x + (segment.to.x - segment.from.x) * t + .5, y: segment.from.y + (segment.to.y - segment.from.y) * t + .5 };
        return findRenderedPathContact(mesh.surface, q) ? [{ time: start + segment.dur * t, index, t }] : [];
      });
      if (!candidates.length) throw new Error("A2_FLAT_SETUP no real moving triangle interior");
      const sample = candidates[0]; advanceGolfer(moving, sample.time, course.condition);
      const rows = liveRenderData(state), row = rows[0], q = { x: row.x + .5, y: row.y + .5 };
      expect(row.segKind).toBe("walk"); expect(row.segT).toBeGreaterThan(0); expect(row.segT).toBeLessThan(1);
      expect(moving.segments[moving.segIndex].mobility?.resolvedMode).toBe("riding_cart");
      const contact = findRenderedPathContact(mesh.surface, q);
      if (!contact) throw new Error("A2_FLAT_SETUP actual moving point is not a final triangle interior");
      const field = inputs.visualHeightfield, cx = Math.floor(q.x), cy = Math.floor(q.y), stride = field.width + 1;
      const fieldCorners = [field.vertices[cy * stride + cx], field.vertices[cy * stride + cx + 1], field.vertices[(cy + 1) * stride + cx], field.vertices[(cy + 1) * stride + cx + 1]];
      const vertexHeights = contact.worldVertices.map(point => sampleVisualHeight(field, point.x, point.y));
      const geometry = { sample, q, contact, fieldCorners, vertexHeights };
      receipt.sample = geometry;
      expect(contact.worldVertices.every(point => point.x >= cx - 1e-8 && point.x <= cx + 1 + 1e-8 && point.y >= cy - 1e-8 && point.y <= cy + 1 + 1e-8), "A2_FLAT_SETUP triangle must remain in the proven flat cell").toBe(true);
      expect(fieldCorners.every(height => height === fieldCorners[0]), "A2_FLAT_SETUP actual emitted product field must be flat").toBe(true);
      expect(vertexHeights.every(height => Math.abs(height - fieldCorners[0]) < 1e-12), "A2_FLAT_SETUP actual triangle vertex heights must be flat").toBe(true);
      const invariant = JSON.stringify({ course, state: state.m51, economics: economicState(moving) });
      tick(pair, state, 10000);
      expect(JSON.stringify({ course, state: state.m51, economics: economicState(moving) })).toBe(invariant);
      const actual = pair.live.golferGrounding(1, rows), vehicle = movingVehicle(pair, assignment.fleetUnitIds[0], rows);
      if (!actual || !vehicle || row.mobilityUnitId !== assignment.fleetUnitIds[0] || row.mobilityUnitMode !== "riding_cart") throw new Error("A2_FLAT_SETUP missing actual active M4 golfer/cart");
      receipt.sample = { ...geometry, assignment, golfer: actual.holder, vehicle: { x: vehicle.position.x, y: vehicle.position.y },
        golferResidualPx: renderedContactResidual(contact, actual.holder), cartResidualPx: renderedContactResidual(contact, vehicle.position, 2) };
      expect(renderedContactMatches(contact, actual.holder)).toBe(true); expect(renderedContactMatches(contact, vehicle.position, 2)).toBe(true);
      receipt.status = "real-production-flat-contact-passed";
    } finally { pair.destroy(); mesh.geometry.destroy(); }
  } catch (error) { receipt.status = "flat-control-red"; receipt.failure = String(error); throw error; }
  finally { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(receipt, null, 2)); vi.restoreAllMocks(); }
});

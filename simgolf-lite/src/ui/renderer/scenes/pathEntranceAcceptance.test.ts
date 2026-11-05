import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import * as continuousPaths from "../../../game/paths/continuousPathPlan";
import { findWalkPathCells } from "../../../game/live/walkPath";
import { planTimedMobilityLeg, type TimedMobilityLeg } from "../../../game/m51/travelRouter";
import type { Course, Point } from "../../../game/models/types";
import type { MobilityMode } from "../../../game/m51/types";
import { measureVisibleJoin, pathJoinFixture, pathJoinSourceReceipt, pathJoinTargets, quantizationAllowance, renderPathJoinComponent, sourceHash, type Polygon } from "../testing/pathJoinFixtures";

const output = process.env.JOINS_B1_RECEIPT ?? resolve(tmpdir(), "coursecraft-joins-b1", `${sourceHash(import.meta.url).slice(0, 12)}.json`);
const sourcePaths = ["../../../game/paths/continuousPathPlan.ts", "../../../game/paths/continuousPathRibbon.ts", "../../../game/paths/continuousPathTopology.ts", "../../../game/render/parklandComposable.ts", "../../../game/render/landscapeGeometry.ts", "../../../game/render/terrainPresentationPolicy.ts", "../../../game/m51/travelRouter.ts", "../../../game/paths/pathMovementAdapter.ts", "./pathMaterialScene.ts"] as const;
function oracleControls() {
  // Pure math falsifiers, not fabricated tee/green product geometry. The
  // product positive control below MUST pass independently on real objects.
  const top: Point[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
  const path: Point[] = [{ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }];
  const shifted = (polygon: Polygon, dx: number) => polygon.map(p => ({ x: p.x + dx, y: p.y }));
  expect(measureVisibleJoin([path], [top], top, 1e-6).positiveContact, "positive-length shared edge oracle control").toBe(true);
  expect(measureVisibleJoin([shifted(path, -1)], [top], top, 1e-6).positiveContact, "offset negative").toBe(false);
  expect(measureVisibleJoin([path], [shifted(top, 2)], shifted(top, 2), 1e-6).positiveContact, "disjoint negative").toBe(false);
  expect(measureVisibleJoin([[{ x: -1, y: -1 }, { x: 0, y: 0 }, { x: -1, y: 0 }]], [top], top, 1e-6).positiveContact, "a single tangent corner is not a positive-width join").toBe(false);
  expect(measureVisibleJoin([path], [top], shifted(top, .5), 1e-6).positiveContact, "the real mask must constrain the top mesh").toBe(false);
  expect(() => quantizationAllowance([new Float32Array([1e8, 1e8])]), "never widen .05px for large coordinates").toThrow(".05 logical px");
}
function routeEvidence(course: Course) {
  const result: { terrain: string; mode: MobilityMode; leg: TimedMobilityLeg }[] = [];
  for (const target of pathJoinTargets) {
    const from = { x: 14, y: target.y }, to = { x: target.x, y: target.y };
    const original = findWalkPathCells(course, from, to);
    expect(original).toEqual([14, 15, 16, 17, 18].map(x => ({ x, y: target.y })));
    for (const mode of ["walk", "pushcart", "riding_cart"] as const) {
      const request = { course, courseId: "B1", layoutId: "B1", mode, from, to };
      if (mode !== "walk") expect(planTimedMobilityLeg({ ...request, allowWalkFallback: false }), `${mode} must not enter protected ${target.terrain}`).toBeNull();
      const leg = planTimedMobilityLeg(request);
      if (!leg) throw new Error(`B1_SETUP actual ${mode} endpoint leg missing`);
      expect(leg.requestedMode).toBe(mode); expect(leg.resolvedMode).toBe("walk"); expect(leg.fallback).toBe(mode === "walk" ? null : "walk");
      expect(leg.cells).toEqual(original); expect(leg.cost).toBe(4); expect(leg.minutes).toBeCloseTo(.6, 12); expect(leg.expansions).toBe(5);
      expect(leg.waypoints.at(-1)).toEqual(to);
      result.push({ terrain: target.terrain, mode, leg });
    }
  }
  return result;
}

it("B1 real Links tee/green masked top-plane: saved boundary positive control then first legacy cap contact gate", () => {
  const receipt: Record<string, unknown> & { frames: unknown[]; routing: unknown[]; failures: unknown[] } = {
    version: 1, source: pathJoinSourceReceipt, coordinateSpace: "Stage world-container isometric logical pixels, prior to camera/GPU/rasterization",
    qualification: "root requires positive-length visible contact; tangent-only and an intentional .2tile turf gap do not satisfy this gate",
    sourceSHA256: Object.fromEntries(sourcePaths.map(path => [path, sourceHash(readFileSync(new URL(path, import.meta.url), "utf8"))])),
    testSHA256: sourceHash(readFileSync(new URL(import.meta.url), "utf8")), fixtureSHA256: sourceHash(readFileSync(new URL("../testing/pathJoinFixtures.ts", import.meta.url), "utf8")),
    frames: [], routing: [], failures: [], gBuildCount: 0,
  };
  const persist = () => { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(receipt, null, 2)); };
  let phase = "oracle-controls";
  persist();
  // Observation only: reuse the real G result naturally constructed by M's
  // actual walking leg. No mocked return, alternate geometry or extra builder.
  const builds = vi.spyOn(continuousPaths, "buildContinuousPathPlan");
  try {
    oracleControls();
    for (const kind of ["saved-boundary", "legacy"] as const) {
      phase = `${kind}:authority`;
      const fixture = pathJoinFixture(kind), before = JSON.stringify(fixture), previousBuilds = builds.mock.calls.length;
      const routes = routeEvidence(fixture.course);
      const observed = builds.mock.results.slice(previousBuilds);
      expect(observed).toHaveLength(1);
      const built = observed[0];
      if (built.type !== "return" || !built.value) throw new Error("B1_SETUP actual mobility path did not produce one observable G plan");
      const plan = built.value;
      receipt.gBuildCount = builds.mock.calls.length;
      const coverage = pathJoinTargets.flatMap(target => [14, 15, 16, 17].map(x => target.y * fixture.course.width + x));
      expect(plan.coverage).toEqual(coverage);
      expect(plan.coverage.every(cell => fixture.course.tiles[cell] === "path")).toBe(true);
      for (const target of pathJoinTargets) expect(fixture.course.tiles[target.y * fixture.course.width + target.x]).toBe(target.terrain);
      expect(JSON.stringify(fixture)).toBe(before);
      receipt.routing.push({ kind, routes, planKey: plan.key, coverage: plan.coverage, inputSHA256: sourceHash(before), protectedTiles: pathJoinTargets.map(target => ({ ...target, terrain: fixture.course.tiles[target.y * fixture.course.width + target.x] })) });
      persist();
      for (const quality of ["low", "high"] as const) for (const rotation of [0, 90] as const) for (const target of pathJoinTargets) {
        phase = `${kind}:${quality}:${rotation}:${target.terrain}`;
        const actual = renderPathJoinComponent(fixture.course, plan, quality, rotation, target);
        try {
          const core = actual.layers.find(layer => layer.role === "core");
          if (!core?.endpointTriangles.length) throw new Error("B1_SETUP actual final core has no endpoint triangles");
          const coreContact = measureVisibleJoin(core.endpointTriangles, actual.top.triangles, actual.maskPolygon, actual.tolerancePx);
          const outerContact = measureVisibleJoin(actual.layers.flatMap(layer => layer.endpointTriangles), actual.top.triangles, actual.maskPolygon, actual.tolerancePx);
          // Graphics hit-testing uses a half-open ray cast at exact edges.
          // Record its boundary answer, but derive CLOSED visible boundary
          // contact from the actual polygon/Float32 mesh intersection above.
          const nativeMaskBoundaryHitTest = coreContact.contactSegments.map(segment => {
            const t = (segment.interval[0] + segment.interval[1]) / 2, [a, b] = segment.maskEdge;
            return actual.mask.containsPoint({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
          });
          const maskInterior = actual.maskPolygon.reduce((p, q) => ({ x: p.x + q.x / actual.maskPolygon.length, y: p.y + q.y / actual.maskPolygon.length }), { x: 0, y: 0 });
          const nativeMaskInteriorFilled = actual.mask.containsPoint(maskInterior);
          const frame = { kind, quality, rotation, target, subdivisions: actual.subdivisions, tolerancePx: actual.tolerancePx, coreContact, outerContact, nativeMaskBoundaryHitTest, maskInterior, nativeMaskInteriorFilled,
            component: actual.component, maskPolygon: actual.maskPolygon, heightfieldVertices: actual.fieldVertices,
            actualTop: { positions: Array.from(actual.top.positions), indices: Array.from(actual.top.indices) },
            actualPath: actual.layers.map(layer => ({ role: layer.role, positions: Array.from(layer.positions), indices: Array.from(layer.indices), endpointWorldVertices: layer.endpointWorldVertices, maximumWorldX: layer.maximumWorldX, sourceWorldBoundaryGap: target.x - layer.maximumWorldX })),
            materialInputs: actual.terrainInputs, courseUnchanged: JSON.stringify(fixture) === before, cash: fixture.world.cash };
          receipt.frames.push(frame); persist();
          expect(JSON.stringify(fixture), "rendering preserves every tile/elevation/feature/building/world/cash field").toBe(before);
          expect(nativeMaskInteriorFilled, "actual native Graphics mask fills the real component interior").toBe(true);
          if (!coreContact.positiveContact || !outerContact.positiveContact) throw new Error(kind === "saved-boundary"
            ? `B1_SETUP saved-boundary positive control misses ACTUAL ${target.terrain} ${quality} r${rotation}; see ${output}`
            : `B1_LEGACY_CONTACT_RED actual ${target.terrain} ${quality} r${rotation}: coreGap=${coreContact.gapPx}px outerGap=${outerContact.gapPx}px; positive-length contact required; see ${output}`);
        } finally { actual.destroy(); }
      }
      expect(routeEvidence(fixture.course)).toEqual(routes);
      expect(JSON.stringify(fixture)).toBe(before);
      expect(builds.mock.calls.length - previousBuilds).toBe(1);
    }
    receipt.verdict = "all-qualified-contact-gates-green";
  } catch (error) {
    receipt.verdict = "stop-first-red"; receipt.failures.push({ phase, error: error instanceof Error ? error.message : String(error) }); throw error;
  } finally { receipt.gBuildCount = builds.mock.calls.length; builds.mockRestore(); persist(); }
}, 20_000);

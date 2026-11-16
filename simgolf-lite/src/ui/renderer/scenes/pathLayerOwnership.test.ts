import { readFileSync } from "node:fs";
import { Container, Mesh, MeshGeometry, Texture } from "pixi.js";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createPathLayerOwnership } from "./pathLayerOwnership";
import type { PathMaterialScenePlan } from "./pathMaterialScene";

const positions = [0, 0, 1, 0, 0, 1];
const indices = [0, 1, 2];
const stageSource = readFileSync(new URL("../../PixiStage.tsx", import.meta.url), "utf8");

function appendActualRelief(owner: Container, register: (mesh: Mesh) => void) {
  const start = stageSource.indexOf("    const appendPathRelief = ");
  const end = stageSource.indexOf("    const generatedMacroTextures", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const code = ts.transpileModule(stageSource.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const append = new Function("PIXI", "pathMacroData", "pathMaterialLayer", "observePathRelief",
    `${code}
return appendPathRelief;`)(
    { Mesh, MeshGeometry },
    { positions: new Float32Array(positions), uvs: new Float32Array(positions), indices: new Uint32Array(indices) },
    owner, register,
  );
  append(Texture.WHITE, "multiply", "continuous-path-landform-shadow");
  append(Texture.WHITE, "screen", "continuous-path-landform-highlight");
}

function indexedPath() {
  return new Mesh({
    geometry: new MeshGeometry({
      positions: new Float32Array(positions), uvs: new Float32Array(positions), indices: new Uint32Array(indices),
    }),
    texture: Texture.WHITE,
  });
}

function setup(quality: PathMaterialScenePlan["quality"] = "low", paths = true) {
  const observer = createPathLayerOwnership();
  const parent = new Container();
  const owner = new Container({ label: "path-material-cross-section" });
  const path = paths ? owner.addChild(indexedPath()) : null;
  const plan: PathMaterialScenePlan = {
    mode: "continuous", quality, key: "current-plan", roles: ["core"], textureRoles: [],
    layers: paths ? [{ role: "core", positions, indices, rings: [] }] : [],
    underlayTiles: [], underlay: [], suppressWholeCellPaths: true,
    componentCount: paths ? 1 : 0, triangleCount: paths ? 1 : 0, widths: { minimum: 0, maximum: 0 },
  };
  const context = { generation: 8, quality, planKey: plan.key };
  const observe = (incoming = owner, attachment = parent) => observer.observeAttachment(attachment, incoming, context.generation, plan);
  const read = (current = context) => observer.read(parent, current);
  return { parent, owner, path, observe, read, context };
}

describe("connected-surface path owner observation", () => {
  it("runs the PixiStage observer guard only in the existing M53 E2E fixture", () => {
    const source = ts.createSourceFile("PixiStage.tsx",
      stageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const declaration = source.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations])
      .find(node => node.name.getText(source) === "pathLayerOwnership");
    const expression = declaration?.initializer?.getText(source);
    expect(expression).toBeDefined();
    const evaluate = new Function("mode", "window", "createPathLayerOwnership",
      `return ${expression!.replaceAll("import.meta.env.MODE", "mode")};`);
    const marker = {};
    const admit = (mode: string, search: string) => evaluate(mode, { location: { search } }, () => marker);
    expect(admit("e2e", "?m53Fixture=1&m53Theme=links")).toBe(marker);
    expect(admit("production", "?m53Fixture=1")).toBeNull();
    expect(admit("development", "?m53Fixture=1")).toBeNull();
    expect(admit("e2e", "?perfFixture=1")).toBeNull();
    expect(admit("e2e", "?m53Fixture=0&extra=m53Fixture%3D1")).toBeNull();
    expect(evaluate("e2e", undefined, () => marker)).toBeNull();
  });

  it("preserves a Low path layer's raw one child and reports only actual attached indexed path meshes", () => {
    const { parent, path, owner, observe, read, context } = setup();
    observe();
    expect(read()).toBeNull();
    parent.addChild(owner);
    expect(parent.children).toEqual([owner]);
    expect(owner.children).toEqual([path]);
    expect(read()).toEqual({ ...context, pathMeshes: 1, pathTriangles: 1, otherOwners: 0, hasVisibleIndexedTerrain: false });
  });

  it("distinguishes an explicitly empty current plan from a missing path mesh", () => {
    const empty = setup("low", false);
    empty.observe();
    empty.parent.addChild(empty.owner);
    expect(empty.read()).toMatchObject({ pathMeshes: 0, pathTriangles: 0, otherOwners: 0 });
    const missing = setup();
    missing.owner.removeChild(missing.path!);
    missing.observe();
    missing.parent.addChild(missing.owner);
    expect(missing.read()).toBeNull();
  });

  it.each(["medium", "high"] as const)("qualifies live indexed %s terrain and exact production-created path relief", (quality) => {
    const { parent, owner, observe, read } = setup(quality);
    const terrain = parent.addChild(new Container());
    terrain.addChild(indexedPath());
    const register = observe();
    expect(register).toBeTypeOf("function");
    appendActualRelief(owner, register!);
    parent.addChild(owner);
    expect(parent.children).toEqual([terrain, owner]);
    expect(read()).toMatchObject({ pathMeshes: 3, pathTriangles: 3, otherOwners: 1, hasVisibleIndexedTerrain: true });
    terrain.removeFromParent();
    expect(read()).toBeNull();
  });

  it("retains the raw High shell count without granting an indexed terrain witness", () => {
    const { parent, owner, observe, read } = setup("high");
    const shells = [new Container(), new Container(), new Container()];
    parent.addChild(...shells);
    observe();
    parent.addChild(owner);
    expect(parent.children).toHaveLength(4);
    expect(read()).toMatchObject({ otherOwners: 3, hasVisibleIndexedTerrain: false });
  });

  it("requires visible live indexed terrain under its actual parent", () => {
    const { parent, owner, observe, read } = setup("medium");
    const terrain = parent.addChild(new Container());
    const mesh = terrain.addChild(indexedPath());
    observe();
    parent.addChild(owner);
    expect(read()?.hasVisibleIndexedTerrain).toBe(true);
    terrain.visible = false;
    expect(read()?.hasVisibleIndexedTerrain).toBe(false);
    terrain.visible = true;
    mesh.renderable = false;
    expect(read()?.hasVisibleIndexedTerrain).toBe(false);
    mesh.renderable = true;
    mesh.geometry.indices = new Uint32Array();
    expect(read()?.hasVisibleIndexedTerrain).toBe(false);
    mesh.destroy();
    expect(read()?.hasVisibleIndexedTerrain).toBe(false);
  });

  it.each(["medium", "high"] as const)("rejects a foreign visible indexed %s mesh inserted before final attachment", (quality) => {
    const { parent, owner, observe, read } = setup(quality);
    parent.addChild(indexedPath());
    const register = observe();
    appendActualRelief(owner, register!);
    const foreign = indexedPath();
    foreign.label = "continuous-path-landform-shadow";
    owner.addChild(foreign);
    parent.addChild(owner);
    expect(owner.children).toContain(foreign);
    expect(read()).toBeNull();
  });

  it("rejects an accepted relief reference replaced before the wrapper attaches", () => {
    const { parent, owner, observe, read } = setup("high");
    const register = observe();
    appendActualRelief(owner, register!);
    const relief = owner.children[1];
    owner.removeChild(relief);
    const foreign = indexedPath();
    foreign.label = relief.label;
    owner.addChildAt(foreign, 1);
    parent.addChild(owner);
    expect(read()).toBeNull();
  });

  it("does not let a path-only Medium attachment supply a positive terrain count", () => {
    const { parent, owner, observe, read } = setup("medium");
    observe();
    parent.addChild(owner);
    expect(read()).toMatchObject({ otherOwners: 0, hasVisibleIndexedTerrain: false });
  });

  it("rejects stale generation, quality, and plan, and does not trust a matching label", () => {
    const { parent, owner, context, observe, read } = setup();
    observe();
    parent.addChild(owner);
    expect(read({ ...context, generation: 9 })).toBeNull();
    expect(read({ ...context, quality: "medium" })).toBeNull();
    expect(read({ ...context, planKey: "other-plan" })).toBeNull();
    parent.removeChild(owner);
    const impostor = parent.addChild(new Container({ label: owner.label }));
    impostor.addChild(indexedPath());
    expect(read()).toBeNull();
  });

  it("rejects an unexpected sibling added after the valid Low path attachment", () => {
    const { parent, owner, observe, read } = setup();
    observe();
    parent.addChild(owner);
    expect(read()?.otherOwners).toBe(0);
    parent.addChild(indexedPath());
    expect(read()).toBeNull();
  });

  it("reports a preexisting terrain sibling instead of granting a Low zero", () => {
    const { parent, owner, observe, read } = setup();
    parent.addChild(indexedPath());
    observe();
    parent.addChild(owner);
    expect(read()?.otherOwners).toBe(1);
  });

  it("rejects a foreign appended or nested child, a removed mesh, and missing indices", () => {
    const { parent, owner, path, observe, read } = setup();
    observe();
    parent.addChild(owner);
    const foreign = indexedPath();
    owner.addChild(foreign);
    expect(read()).toBeNull();
    foreign.removeFromParent();
    const nested = new Container();
    path!.addChild(nested);
    expect(read()).toBeNull();
    nested.removeFromParent();
    path!.geometry.indices = new Uint32Array();
    expect(read()).toBeNull();
    path!.removeFromParent();
    expect(read()).toBeNull();
  });

  it("a second rebuild invalidates even a still-attached previous wrapper", () => {
    const { parent, owner, observe, read } = setup();
    observe();
    parent.addChild(owner);
    expect(read()).not.toBeNull();
    const next = new Container();
    next.addChild(indexedPath());
    observe(next);
    expect(read()).toBeNull();
    owner.removeFromParent();
    parent.addChild(next);
    expect(read()).not.toBeNull();
    parent.removeChild(next);
    parent.addChild(owner);
    expect(read()).toBeNull();
  });

  it("refuses attachment to a foreign parent and ignores a hidden wrapper", () => {
    const { parent, owner, observe, read } = setup();
    const foreign = new Container();
    observe();
    foreign.addChild(owner);
    parent.addChild(owner);
    expect(read()).toBeNull();
    parent.removeChild(owner);
    observe();
    parent.addChild(owner);
    owner.visible = false;
    expect(read()).toBeNull();
  });
});

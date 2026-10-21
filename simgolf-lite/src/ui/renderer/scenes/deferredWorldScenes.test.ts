import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createOverlaysDiagnosticsSceneSystem } from "./overlaysDiagnosticsScene";

describe("deferred world scene activation", () => {
  it("exposes the existing overlay factory at the established world activation boundary", async () => {
    const deferred = await import("./deferredWorldScenes");
    expect(deferred.createOverlaysDiagnosticsSceneSystem).toBe(createOverlaysDiagnosticsSceneSystem);
    const source = readFileSync(new URL("../../PixiStage.tsx", import.meta.url), "utf8");
    expect(source).toContain('import type { OverlaysDiagnosticsSceneSystem } from "./renderer/scenes/overlaysDiagnosticsScene"');
    expect(source).toContain("deferredWorldScenes.createOverlaysDiagnosticsSceneSystem(");
    expect(source).not.toMatch(/import\s*\{[^}]*createOverlaysDiagnosticsSceneSystem/);
    for (const factory of ["createLiveEntitiesSceneSystem", "createAtmosphereSceneSystem", "createArchitectureOverlaySceneSystem"]) {
      expect(source).toContain(`deferredWorldScenes.${factory}(`);
      expect(source).not.toMatch(new RegExp(`import\\s*\\{[^}]*${factory}`));
    }
    expect(source).toContain('import { routeDestinationHierarchy } from "./renderer/scenes/routeDestinationHierarchy"');
  });
});

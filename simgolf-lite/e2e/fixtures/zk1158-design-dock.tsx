import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../../src/i18n/I18nProvider";
import type {
  DecorationRotation,
  TerrainAuthoringTool,
} from "../../src/game/models/types";
import { DesignDock } from "../../src/ui/DesignDock";
import { buildDesignCatalog } from "../../src/ui/designCatalog";
import "../../src/index.css";

export function DesignDockFixture() {
  const [selectedItemId, setSelectedItemId] = useState("terrain:fairway");
  const [terrainTool, setTerrainTool] = useState<TerrainAuthoringTool>("curve");
  const [terrainBrushWidth, setTerrainBrushWidth] = useState(5);
  const [decorationAction, setDecorationAction] = useState<"place" | "rotate" | "remove">("place");
  const [decorationRotation, setDecorationRotation] = useState<DecorationRotation>(0);
  const [decorationSpan, setDecorationSpan] = useState(3);
  const catalog = useMemo(() => buildDesignCatalog({
    theme: "parkland",
    season: "summer",
    weatherKind: "clear",
    costMult: 1,
    colorVision: "standard",
    decorationSpan,
  }), [decorationSpan]);

  return (
    <main className="cc-course-pane" data-testid="design-dock-fixture-ready">
      <DesignDock
        theme="parkland"
        quality="low"
        catalog={catalog}
        selectedItemId={selectedItemId}
        cash={25_000}
        reputation={100}
        terrainTool={terrainTool}
        onTerrainTool={setTerrainTool}
        terrainBrushWidth={terrainBrushWidth}
        onTerrainBrushWidth={setTerrainBrushWidth}
        onUndo={() => undefined}
        onRedo={() => undefined}
        onSelect={(item) => setSelectedItemId(item.id)}
        decorationAction={decorationAction}
        onDecorationAction={setDecorationAction}
        decorationRotation={decorationRotation}
        onDecorationRotation={setDecorationRotation}
        decorationSpan={decorationSpan}
        onDecorationSpan={setDecorationSpan}
        onOpenGolfopedia={() => undefined}
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <I18nProvider>
    <DesignDockFixture />
  </I18nProvider>,
);

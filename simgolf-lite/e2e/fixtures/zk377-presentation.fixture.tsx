import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../../src/game/models/defaults";
import { createEstate } from "../../src/game/estate/estate";
import { useI18n } from "../../src/i18n/useI18n";
import { I18nProvider } from "../../src/i18n/I18nProvider";
import { LandOfficePanel } from "../../src/ui/LandOfficePanel";
import { ProgressionPanel } from "../../src/ui/ProgressionPanel";
import "../../src/index.css";
import "./zk377-presentation.fixture.css";

const LAND_COURSE = (() => {
  const course = structuredClone(DEFAULT_COURSE);
  course.estate = createEstate(course, 37_701);
  return course;
})();

const LAND_ESTATE = LAND_COURSE.estate!;
const STARTER_PARCEL_ID = LAND_ESTATE.starterParcelId;
const ADJACENT_PARCEL_ID = LAND_ESTATE.parcels.find((parcel) =>
  !LAND_ESTATE.ownedParcelIds.includes(parcel.id)
  && parcel.adjacentParcelIds.includes(STARTER_PARCEL_ID)
)!.id;
const NON_ADJACENT_PARCEL_ID = LAND_ESTATE.parcels.find((parcel) =>
  !LAND_ESTATE.ownedParcelIds.includes(parcel.id)
  && !parcel.adjacentParcelIds.includes(STARTER_PARCEL_ID)
)!.id;

export function PresentationFixture() {
  const { locale, setLocale } = useI18n();
  const [openPanel, setOpenPanel] = useState<"progression" | "land" | null>("progression");
  const [reputation, setReputation] = useState(40);
  const [cash, setCash] = useState(100_000_000);
  const [selectedParcelId, setSelectedParcelId] = useState(ADJACENT_PARCEL_ID);
  const [calls, setCalls] = useState<string[]>([]);
  const world = useMemo(() => ({ ...DEFAULT_WORLD, cash }), [cash]);
  const record = (call: string) => setCalls((current) => [...current, call]);

  return (
    <main
      className="zk377-presentation-stage"
      data-testid="zk377-presentation-ready"
      data-adjacent-parcel={ADJACENT_PARCEL_ID}
      data-non-adjacent-parcel={NON_ADJACENT_PARCEL_ID}
      data-owned-parcel={STARTER_PARCEL_ID}
      data-selected-center={JSON.stringify(
        LAND_ESTATE.parcels.find((parcel) => parcel.id === selectedParcelId)?.center,
      )}
    >
      <nav className="zk377-presentation-stage__tools" aria-label="Fixture controls">
        <button type="button" onClick={() => setOpenPanel("progression")}>Open progression</button>
        <button type="button" onClick={() => setOpenPanel("land")}>Open land office</button>
        <button
          type="button"
          data-testid="locale-toggle"
          onClick={() => setLocale(locale === "en" ? "pseudo" : "en")}
        >
          {locale === "en" ? "Use pseudo locale" : "Use English"}
        </button>
        <button type="button" data-testid="cash-zero" onClick={() => setCash(0)}>
          Set cash to zero
        </button>
        <button type="button" data-testid="cash-available" onClick={() => setCash(100_000_000)}>
          Restore cash
        </button>
        <button type="button" data-testid="rep-70" onClick={() => setReputation(70)}>
          Set reputation to 70
        </button>
      </nav>

      {openPanel === "progression" && (
        <ProgressionPanel
          reputation={reputation}
          onClose={() => {
            record("close:progression");
            setOpenPanel(null);
          }}
        />
      )}
      {openPanel === "land" && (
        <LandOfficePanel
          course={LAND_COURSE}
          world={world}
          selectedParcelId={selectedParcelId}
          onSelect={(parcelId) => {
            record(`select:${parcelId}`);
            setSelectedParcelId(parcelId);
          }}
          onCenter={(point) => record(`center:${point.x},${point.y}`)}
          onPurchase={(parcelId) => record(`purchase:${parcelId}`)}
          onClose={() => {
            record("close:land");
            setOpenPanel(null);
          }}
        />
      )}
      <output className="zk377-presentation-stage__calls" data-testid="callback-log" aria-live="polite">
        {calls.join("|")}
      </output>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <I18nProvider>
    <PresentationFixture />
  </I18nProvider>,
);

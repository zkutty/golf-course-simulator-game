/// <reference types="vite/client" />

/** App version injected at build time from package.json (see vite.config.ts). */
declare const __APP_VERSION__: string;
/** Release and commit identifiers injected by Vite for deployment telemetry. */
declare const __APP_RELEASE__: string;
declare const __COMMIT_SHA__: string;

interface ImportMetaEnv {
  readonly VITE_APP_ENVIRONMENT?: string;
  readonly VITE_BUG_REPORTING?: string;
}

interface Window {
  coursecraftDesktop?: import("./platform/types").CourseCraftDesktopBridge;
  render_game_to_text?: () => string;
  advanceTime?: (ms: number) => void;
  __coursecraftPixiTest?: {
    fitWholeCourse(): void;
    viewport(): { width: number; height: number } | null;
    tileToScreen(x: number, y: number): { x: number; y: number } | null;
    screenToTile(x: number, y: number): { x: number; y: number } | null;
    surfaceCareLayer(): {
      children: number;
      workers: number;
      index: number;
      seasonalIndex: number;
      markerIndex: number;
      objectsIndex: number;
    } | null;
  };
  __coursecraftTest?: {
    state(): {
      screen: string;
      screenBase: "title" | "setup-wizard" | "loading" | "in-game";
      paused: boolean;
      modal: "options" | "save-load" | "golfopedia" | "scenario-select" | null;
      dirty: boolean;
      speed: "paused" | "1x" | "2x" | "4x";
      dayMinute: number;
      weekReportOpen: boolean;
      golferPositions: Array<[number, number, number]>;
      week: number;
      cash: number;
      terrainVersion: number;
      economyVersion: number;
      terrainCounts: Partial<Record<import("./game/models/types").Terrain, number>>;
      courseHash: string;
    };
    terrainSurfaceState(): {
      width: number;
      height: number;
      tiles: import("./game/models/types").Terrain[];
      elevations: number[];
      owned: boolean[];
      holes: Array<{
        tee: { x: number; y: number } | null;
        green: { x: number; y: number } | null;
        valid: boolean;
        issues: string[];
      }>;
      obstacles: import("./game/models/types").Obstacle[];
      features: Array<{
        id: string;
        terrain: import("./game/models/types").Terrain;
        kind: "corridor" | "region";
        points: Array<{ x: number; y: number }>;
        tangents: Array<{
          in: { x: number; y: number };
          out: { x: number; y: number };
        }> | null;
        width: number | null;
        coverage: number[];
        renderRings: Array<Array<{ x: number; y: number }>>;
      }>;
    };
    m35Metrics(): import("./game/render/m35Telemetry").M35TelemetrySnapshot;
    resetM35Metrics(): void;
    setPaintCash(cash: number): void;
    setPropertyFixture(): void;
    setPlayerProFixture(): void;
    setM39Fixture(): void;
    setM52ReferenceBookmark(
      view: import("./game/testing/biomeAuthoring").BiomeReferenceView,
      rotation: import("./game/testing/biomeAuthoring").BiomeReferenceRotation,
    ): void;
    startWeekCloseFixture(weekOverride?: number): Promise<void>;
    runGoldenWeek(): Promise<{
      beforeHash: string;
      afterHash: string;
      week: number;
      cash: number;
      rounds: number;
    }>;
    runResortGoldenPath(): Promise<{
      beforeHash: string;
      afterHash: string;
      status: string;
      fulfilled: number;
      total: number;
      folioTotal: number;
      value: number;
      serviceQueue: number;
    }>;
    runM33GoldenPath(): Promise<{
      beforeHash: string;
      afterHash: string;
      strategy: string;
      status: string;
      units: number;
      households: number;
      tenure: string;
      incidentKind: string;
      complaintStatus: string;
      claimStatus: string;
      riskWithoutMitigation: number;
      riskWithMitigation: number;
      protectedEasements: number;
      realEstateRevenue: number;
      realEstateCosts: number;
      residentLocalSpend: number;
      residentMembers: number;
      cash: number;
    }>;
    validateFixture(text: string):
      | { ok: true; migratedFrom: number | null }
      | { ok: false; error: string };
    startTournamentFixture(): void;
    invalidateAndCancelTournamentFixture(): void;
    setM53SeasonalFixture(season: "spring" | "summer" | "autumn" | "winter"): void;
    setM53SurfaceCareFixture(
      mode?: "evidence" | "resolved" | "healthy" | "cue-only" | "mowing",
    ): void;
  };
}

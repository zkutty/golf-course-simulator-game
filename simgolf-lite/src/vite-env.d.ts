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
  __coursecraftAnalysisWorkerBenchmark?: Promise<import("./game/analysis/benchmark").AnalysisWorkerBenchmarkReport>;
  coursecraftDesktop?: import("./platform/types").CourseCraftDesktopBridge;
  render_game_to_text?: () => string;
  advanceTime?: (ms: number) => void;
  __coursecraftPixiTest?: {
    fitWholeCourse(): void;
    viewport(): { width: number; height: number } | null;
    tileToScreen(x: number, y: number): { x: number; y: number } | null;
    openingPreview(): { targetIds: number[]; outlineCount: number } | null;
    screenToTile(x: number, y: number): { x: number; y: number } | null;
    screenToWorld(x: number, y: number): { x: number; y: number } | null;
    terrainStrokePointerDownCell(): { x: number; y: number } | null;
    resetTerrainStrokePointerDownCell(): void;
    surfaceCareLayer(): {
      children: number;
      workers: number;
      index: number;
      seasonalIndex: number;
      markerIndex: number;
      objectsIndex: number;
    } | null;
    terrainPreview(): {
      revision: number;
      previewKind: "stroke" | "surface-edit";
      selectedTerrain: import("./game/models/types").Terrain | null;
      materials: import("./game/models/types").Terrain[];
      colors: Partial<Record<import("./game/models/types").Terrain, number>>;
    } | null;
    routeOverlay(): {
      geometrySamples: number;
      semanticTargets: number;
      fullShotSegments: number;
      expectedPutts: number;
      visibleLayers: number;
    };
    playerProCollectionDisplay(): {
      rebuilds: number;
      items: readonly { label: string; x: number; y: number; zIndex: number }[];
    };
    rendererAtlasState(): {
      requested: {
        biome: import("./game/models/types").LandTheme;
        quality: "high" | "medium" | "low";
        season: import("./game/seasons/types").SeasonName | null;
        bundleKey: string;
        resolutionScale: number;
        seasonalVisualSignature: string;
      };
      rendered: import("./render/atlas").AtlasRenderContext & {
        resolutionScale: number;
        seasonalVisualSignature: string;
      };
      activation: import("./render/atlas").AtlasActivationSnapshot;
      residency: import("./render/atlas").AtlasResidencySnapshot;
      fallbacks: readonly import("./render/atlas").AtlasFallbackDiagnostic[];
      camera: { zoom: number; targetZoom: number; groundCoverTier: 0 | 1 | 2 };
      parklandComposable: import("./game/render/parklandComposable").ParklandComposableDiagnostics & {
        camera: { rotation: number; zoom: number; targetZoom: number };
      };
      sharedContours: {
        authoritativeSingletonDeepRough: number;
        distinctSingletonDeepRoughFields: number;
        distinctSingletonDeepRoughBands: number;
        coalescedSingletonDeepRough: number;
        enclosedSingletonRoughToFairway: number;
        policy: {
          classification: typeof import("./game/render/terrainPresentationPolicy").TERRAIN_PRESENTATION_POLICY;
          tileSurface: readonly import("./game/models/types").Terrain[];
          organicHazard: readonly import("./game/models/types").Terrain[];
          route: readonly import("./game/models/types").Terrain[];
        };
        mappings: readonly import("./game/render/terrainPresentationPolicy").TerrainPresentationMapping[];
        authoritativeBytes: string;
        presentationBytes: string;
        authoritativeCellCounts: Readonly<Record<import("./game/models/types").Terrain, number>>;
        presentationCellCounts: Readonly<Record<import("./game/models/types").Terrain, number>>;
        authoritativeComponentCounts: Readonly<Record<import("./game/models/types").Terrain, number>>;
        presentationComponentCounts: Readonly<Record<import("./game/models/types").Terrain, number>>;
        authoritativeRingCounts: Readonly<Record<import("./game/models/types").Terrain, number>>;
        presentationRingCounts: Readonly<Record<import("./game/models/types").Terrain, number>>;
        tileSurfaceConnectedMasks: number;
      };
      layers: Record<string, number | null> | null;
      counts: {
        terrainChunks: number;
        terrainRebuilds: number;
        connectedSurfaces: number;
        structuresAndProps: number;
        naturalProps: {
          content: number;
          rebuilds: number;
          fallbackTextures: number;
          habitatMasses: number;
          habitatBedLayers: number;
        };
        dressing: number;
      } | null;
    };
    unrelatedObjectCountProbe(): { before: number; after: number };
    setZoomForTest(zoom: number): void;
    focusTileForTest(x: number, y: number, zoom: number): void;
    golferGrounding(id: number): {
      golfer: { x: number; y: number; segKind: string | null; segT: number };
      sample: { x: number; y: number; elevation: number };
      expected: { x: number; y: number; depth: number };
      holder: { x: number; y: number; depth: number; visible: boolean };
      feet: { x: number; y: number; anchorY: number } | null;
      shadow: { label: string; x: number; y: number; alpha: number } | null;
      sprite: { walkPhase: number; frame: string } | null;
      poolCount: number;
      activeEffects: number;
    } | null;
  };
  __coursecraftTest?: {
    setGraphicsQualityFixture(quality: "high" | "medium" | "low"): void;
    setRendererThemeFixture(theme: import("./game/models/types").LandTheme): void;
    setRendererSeasonFixture(season: import("./game/seasons/types").SeasonName): void;
    setZk330GroundingFixture(): void;
    setZk330GroundingProgress(progress: number): void;
    setZk330GroundingPause(): void;
    setZk330CaptureState(rotation: 0 | 1 | 2 | 3, quality: "high" | "medium" | "low"): void;
    zk330GroundingEvidence(): { validBridgeCrossing: boolean; blockedWaterBank: boolean };
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
      loadingContext: import("./ui/loadingBiomeContext").LoadingBiomeContext | null;
      terrainCounts: Partial<Record<import("./game/models/types").Terrain, number>>;
      courseHash: string;
    };
    seedLoadingSaveFixture(options: {
      id: string;
      theme: import("./game/models/types").LandTheme;
      week: number;
      dayIndex: number;
      omitManifestTheme?: boolean;
      deletePayload?: boolean;
    }): Promise<{
      id: string;
      context: import("./ui/loadingBiomeContext").LoadingBiomeContext;
    }>;
    returnToTitle(): void;
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
      greenSurface: import("./game/greens/greenSurface").GreenSurfaceV1 | null;
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
    setZk470PlacementFixture(actionClass: "terrain-stroke" | "tee" | "pin" | "prop" | "structure" | "occlusion-selection"): Promise<import("./game/testing/zk470PlacementFixture").Zk470PlacementTarget>;
    configureZk470PlacementAction(actionClass: "terrain-stroke" | "tee" | "pin" | "prop" | "structure" | "occlusion-selection"): void;
    zk470PlacementSnapshot(actionClass: "terrain-stroke" | "tee" | "pin" | "prop" | "structure" | "occlusion-selection"): Promise<{
      target: import("./game/testing/zk470PlacementFixture").Zk470PlacementTarget;
      selectedCell: { x: number; y: number } | null;
      handledPointerCell: { x: number; y: number } | null;
      committedCell: { x: number; y: number } | null;
      courseHash: string;
      worldHash: string;
      authoritative: {
        terrain: import("./game/models/types").Terrain;
        tee: { x: number; y: number } | null;
        pin: { x: number; y: number } | null;
        obstacle: import("./game/models/types").Obstacle | null;
        building: import("./game/models/types").Building | null;
      };
    }>;
    zk470Undo(): void;
    zk470Redo(): void;
    zk470PersistenceProbe(actionClass: "terrain-stroke" | "tee" | "pin" | "prop" | "structure" | "occlusion-selection"): Promise<{
      id: string;
      beforeHash: string;
      afterHash: string | null;
      firstDifference: { path: string; before: unknown; after: unknown } | null;
      cleanedUp: boolean;
    }>;
    advanceLiveClock(realMs: number, speed: "1x" | "2x" | "4x"): {
      dayMinute: number;
      speed: "paused" | "1x" | "2x" | "4x";
      clockRemainderMinutes: number;
    };
    setPropertyFixture(): void;
    setPlayerProFixture(): void;
    setChallengeContractFixture(): Promise<void>;
    setZk731DisplayFixture(): Promise<void>;
    moveZk731DisplayVehicleToCustody(): Promise<void>;
    forceChallengeRivalWithdrawal(): Promise<void>;
    forceChallengeTieCompletion(): Promise<void>;
    setChallengeGroupRoundFixture(groupSize?: 2 | 3 | 4): void;
    setM39Fixture(): void;
    setZk688ClassicFixture(): void;
    setZk689SimulationFixture(): void;
    setZk690CampaignFixture(chapterId: string, phaseIndex?: number): void;
    setZk690LegacyRecoveryFixture(): void;
    setZk690LegacyFinaleFixture(): void;
    setCampaignObjectiveWonFixture(): void;
    advanceCampaignFixture(): void;
    showZk688AdvisorMessage(target: "pricing" | "maintenance"): void;
    pauseLiveSimulation(): void;
    takeSystemControl(system: import("./game/experience/systemControl").AdvancedSystemId): void;
    setZk687RecoveryFixture(): Promise<void>;
    advanceSystemControlDay(): {
      greenFee: number;
      propertyMode: string;
      propertySource: string;
    };
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
    validateFixture(text: string): Promise<
      | { ok: true; migratedFrom: number | null }
      | { ok: false; error: string }>;
    startTournamentFixture(): Promise<void>;
    invalidateAndCancelTournamentFixture(): void;
    setM53SeasonalFixture(season: "spring" | "summer" | "autumn" | "winter"): void;
    setM53SurfaceCareFixture(
      mode?: "evidence" | "resolved" | "healthy" | "cue-only" | "mowing",
    ): void;
  };
}

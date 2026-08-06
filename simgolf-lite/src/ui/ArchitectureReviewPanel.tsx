import { useMemo, useState } from "react";
import type { Course } from "../game/models/types";
import type { ArchitectureReviewData, ArchitectureReviewFilters } from "../game/architecture/review";
import type { ArchitectureOverlayKind } from "../game/architecture/reviewTypes";
import { courseLayouts } from "../game/models/courseLayouts";
import { useI18n } from "../i18n/useI18n";
import type { MessageKey } from "../i18n/catalog";

const OVERLAYS: ArchitectureOverlayKind[] = [
  "traces", "dispersion", "heatmap", "recovery", "scoring", "hazards", "walking", "mobility", "congestion", "options", "advantage", "bailouts", "carries", "misses",
  "green-preferred", "green-putts", "green-leaves", "green-misses", "green-rollout", "green-risk",
];

export function ArchitectureReviewPanel(props: {
  course: Course;
  review: ArchitectureReviewData;
  onFilters: (filters: ArchitectureReviewFilters) => void;
  onJump: (point: { x: number; y: number }, holeId?: string) => void;
  onPracticeRound: (courseId: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [message, setMessage] = useState("");
  const [comparisonId, setComparisonId] = useState(props.review.revisions[1]?.id ?? "");
  const selectedRevision = props.review.revisions.find((revision) => revision.id === comparisonId);
  const currentRevision = props.review.revisions.find((revision) => revision.geometryVersion === props.review.currentGeometryVersion);
  const strategicComparison = props.review.comparison;
  const signed = (value: number) => value > 0 ? `+${value}` : `${value}`;
  const holes = useMemo(() => props.course.holes.filter((hole) => hole.id), [props.course.holes]);
  const set = <K extends keyof ArchitectureReviewFilters>(key: K, value: ArchitectureReviewFilters[K]) =>
    props.onFilters({ ...props.review.filters, [key]: value });
  return <aside
    className="cc-tycoon-panel"
    role="dialog"
    aria-modal="false"
    aria-labelledby="architecture-review-title"
    data-testid="architecture-review"
    style={{ position: "absolute", zIndex: 145, top: 58, right: 14, width: "min(430px,calc(100% - 28px))", maxHeight: "calc(100% - 116px)", overflow: "auto", padding: 14, background: "#f4ead3", border: "2px solid #806946", borderRadius: 14, color: "#26362d" }}
  >
    <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
      <div><div id="architecture-review-title" style={{ fontSize: 20, fontWeight: 900 }}>{t("architecture.review.title")}</div><small>{t("architecture.review.subtitle")}</small></div>
      <button aria-label={t("common.close")} onClick={props.onClose}>✕</button>
    </header>

    <nav aria-label={t("architecture.review.overlays")} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(92px,1fr))", gap: 5, margin: "12px 0" }}>
      {OVERLAYS.map((kind) => <button
        key={kind}
        data-testid={`architecture-overlay-${kind}`}
        aria-pressed={props.review.filters.kind === kind}
        onClick={() => set("kind", kind)}
        style={{ padding: "7px 4px", fontSize: 11, background: props.review.filters.kind === kind ? "#476f5b" : "#fffdf6", color: props.review.filters.kind === kind ? "white" : "#26362d" }}
      >{t(`architecture.review.overlay.${kind}` as MessageKey)}</button>)}
    </nav>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
      <label>{t("architecture.review.course")}<select value={props.review.filters.courseId} onChange={(event) => set("courseId", event.target.value)}>{courseLayouts(props.course).map((layout) => <option value={layout.id} key={layout.id}>{layout.name}</option>)}</select></label>
      <label>{t("architecture.review.hole")}<select data-testid="architecture-hole-filter" value={props.review.filters.holeId} onChange={(event) => set("holeId", event.target.value)}><option value="all">{t("architecture.review.all")}</option>{holes.map((hole) => <option key={hole.id} value={hole.id}>{hole.name ?? hole.id}</option>)}</select></label>
      <label>{t("architecture.review.tee")}<select value={props.review.filters.teeSet} onChange={(event) => set("teeSet", event.target.value as ArchitectureReviewFilters["teeSet"])}>{(["all", "forward", "member", "championship"] as const).map((value) => <option value={value} key={value}>{value === "all" ? t("architecture.review.all") : value}</option>)}</select></label>
      <label>{t("architecture.review.pin")}<select value={props.review.filters.pinRotation} onChange={(event) => set("pinRotation", event.target.value as ArchitectureReviewFilters["pinRotation"])}>{(["A", "B", "C", "all"] as const).map((value) => <option value={value} key={value}>{value === "all" ? t("architecture.review.all") : value}</option>)}</select></label>
      <label>{t("architecture.review.segment")}<select value={props.review.filters.sourceSegment} onChange={(event) => set("sourceSegment", event.target.value)}><option value="all">{t("architecture.review.all")}</option>{props.review.sourceSegments.map((value) => <option key={value}>{value}</option>)}</select></label>
      {props.review.filters.kind.startsWith("green-") && <label>{t("architecture.green.cohort")}<select data-testid="architecture-green-cohort" value={props.review.filters.cohortId} onChange={(event) => set("cohortId", event.target.value as ArchitectureReviewFilters["cohortId"])}>{(["all", "power", "accuracy", "shortGame", "recovery", "casual"] as const).map((value) => <option value={value} key={value}>{value === "all" ? t("architecture.review.all") : t(`architecture.green.cohort.${value}` as MessageKey)}</option>)}</select></label>}
      <label style={{ gridColumn: "1 / -1" }}>{t("architecture.review.evidenceAge")}<select data-testid="architecture-age-filter" value={props.review.filters.recency} onChange={(event) => set("recency", event.target.value as ArchitectureReviewFilters["recency"])}>{(["current", "recent", "historical", "all"] as const).map((value) => <option value={value} key={value}>{t(`architecture.review.age.${value}` as MessageKey)}</option>)}</select></label>
      {props.review.filters.kind === "mobility" && <label style={{ gridColumn: "1 / -1" }}>{t("architecture.review.mobility.mode")}<select data-testid="architecture-mobility-mode" value={props.review.filters.mobilityMode} onChange={(event) => set("mobilityMode", event.target.value as ArchitectureReviewFilters["mobilityMode"])}><option value="all">{t("architecture.review.mobility.allModes")}</option><option value="walk">{t("architecture.review.mobility.walk")}</option><option value="pushcart">{t("architecture.review.mobility.pushcart")}</option><option value="riding_cart">{t("architecture.review.mobility.ridingCart")}</option></select></label>}
    </div>

    <section data-status={props.review.status} style={{ marginTop: 11, padding: 10, borderRadius: 9, background: props.review.status === "ready" ? "#e0efdf" : props.review.status === "stale-only" ? "#f8e3b8" : "#fff7e6", border: "1px solid #b9aa91" }}>
      <strong>{t(`architecture.review.status.${props.review.status}` as MessageKey)}</strong>
      <p style={{ margin: "5px 0 0", fontSize: 12 }}>{props.review.explanation}</p>
      <div style={{ display: "flex", gap: 12, marginTop: 7, fontSize: 12 }}>
        <span>{t("architecture.review.currentCount", { count: props.review.currentEvidence })}</span>
        <span>{t("architecture.review.historicalCount", { count: props.review.historicalEvidence })}</span>
      </div>
    </section>

    {props.review.returnToDesign && <section data-testid="architecture-return-context" style={{ marginTop: 12, padding: 10, borderRadius: 9, background: "#e7edf6", border: "1px solid #8391a7" }}>
      <strong>{t("architecture.green.return.title")}</strong>
      <p style={{ margin: "5px 0", fontSize: 12 }}>{t("architecture.green.return.body", {
        hole: props.review.returnToDesign.holeId,
        geometry: props.review.returnToDesign.geometryVersion === props.review.currentGeometryVersion ? t("architecture.review.current") : t("architecture.review.historical"),
      })}</p>
      <button data-testid="architecture-return-jump" onClick={() => props.onJump(props.review.returnToDesign!.point, props.review.returnToDesign!.holeId)}>{t("architecture.green.return.jump")}</button>
    </section>}

    {props.review.filters.kind.startsWith("green-") && !props.review.greenStrategy && <section data-testid="architecture-green-loading" role="status" style={{ marginTop: 12, padding: 10, borderRadius: 9, background: "#edf3e2", border: "1px solid #7f966e" }}>{t("architecture.green.loading")}</section>}

    {props.review.greenStrategy && <section data-testid="architecture-green-strategy" style={{ marginTop: 12, padding: 10, borderRadius: 9, background: "#edf3e2", border: "1px solid #7f966e" }}>
      <strong>{t("architecture.green.title")}</strong>
      <p data-testid="architecture-green-source" style={{ margin: "5px 0", fontSize: 12 }}>{t("architecture.green.source", {
        geometry: props.review.greenStrategy.forecastGeometryVersion,
        program: props.review.greenStrategy.maintenanceProgram,
        samples: props.review.greenStrategy.predictiveSamples,
      })}</p>
      <small style={{ display: "block", marginBottom: 6 }}>{t("architecture.green.filterScope")}</small>
      {props.review.greenStrategy.observedHistorical > 0 && <p data-testid="architecture-green-history" style={{ margin: "5px 0", padding: 6, border: "1px dashed #725e8e", background: "#f2ecf7", fontSize: 12 }}><b>{t("architecture.green.history.title")}</b> {t("architecture.green.history.body", { count: props.review.greenStrategy.observedHistorical })}</p>}
      <div aria-label={t("architecture.green.legend")} style={{ display: "grid", gap: 4, marginTop: 8 }}>
        {props.review.greenStrategy.legend.map((item) => <div key={item.id} style={{ display: "grid", gridTemplateColumns: "28px 1fr", gap: 6, alignItems: "start", fontSize: 11 }}>
          <span aria-hidden="true" style={{ textAlign: "center", border: "1px solid currentColor", borderRadius: 3, fontWeight: 900 }}>{item.pattern === "dots" ? "••" : item.pattern === "cross" ? "++" : item.pattern === "diagonal" ? "///" : "■"}</span>
          <span><b>{t(`architecture.green.legend.${item.id}.label` as MessageKey)}</b> · {t(`architecture.green.legend.${item.id}.body` as MessageKey)}</span>
        </div>)}
      </div>
      <div data-testid="architecture-green-report" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(135px,1fr))", gap: 5, marginTop: 9, fontSize: 12 }}>
        <span>{t("architecture.green.report.attack", { value: props.review.greenStrategy.report.attackExpectedPutts ?? t("architecture.green.na") })}</span>
        <span>{t("architecture.green.report.safe", { value: props.review.greenStrategy.report.safeExpectedPutts ?? t("architecture.green.na") })}</span>
        <span>{t("architecture.green.report.approach", { value: props.review.greenStrategy.report.approachAdvantage })}</span>
        <span>{t("architecture.green.report.shortSide", { value: Math.round(props.review.greenStrategy.report.shortSidePunishment * 100) })}</span>
        <span>{t("architecture.green.report.rotation", { value: Math.round(props.review.greenStrategy.report.rotationVariety * 100) })}</span>
        <span>{t("architecture.green.report.cohorts", { value: Math.round(props.review.greenStrategy.report.cohortSeparation * 100) })}</span>
        <span>{t("architecture.green.report.unfairness", { value: Math.round(props.review.greenStrategy.report.unfairness * 100) })}</span>
      </div>
      <details style={{ marginTop: 8 }}>
        <summary>{t("architecture.green.textEquivalent")}</summary>
        <p style={{ fontSize: 12 }}>{props.review.greenStrategy.textSummary}</p>
      </details>
      {props.review.greenStrategy.recommendations.length > 0 && <div style={{ display: "grid", gap: 5, marginTop: 9 }}>
        <b>{t("architecture.green.actions")}</b>
        {props.review.greenStrategy.recommendations.map((item) => <button key={item.id} data-severity={item.severity} onClick={() => props.onJump(item.location, item.holeId)} style={{ textAlign: "left", background: item.severity === "warning" ? "#fff0e6" : "#fffdf6" }}>
          <b>{t(item.titleKey as MessageKey)}</b><small style={{ display: "block" }}>{t(item.detailKey as MessageKey)} · {t("architecture.green.jump")}</small>
        </button>)}
      </div>}
      <small style={{ display: "block", marginTop: 8 }}>{t("architecture.green.static")}</small>
    </section>}

    {props.review.mobility && <section data-testid="architecture-mobility-summary" style={{ marginTop: 12, padding: 10, borderRadius: 9, background: "#e5f0e0", border: "1px solid #8aa27f" }}>
      <strong>{t("architecture.review.mobility.forecast")}</strong>
      <div style={{ display: "grid", gap: 4, marginTop: 6, fontSize: 12 }}>
        <span>{t("architecture.review.mobility.modes", { modes: props.review.mobility.modes.join(", "), weather: props.review.mobility.weather })}</span>
        <span>{t("architecture.review.mobility.transfers", { transfers: props.review.mobility.transfers, utilization: props.review.mobility.pathUtilization })}</span>
        <span>{t("architecture.review.mobility.inaccessible", { count: props.review.mobility.inaccessibleDestinations.length })}</span>
        {props.review.mobility.missingLinkWarnings.map((warning) => <small key={warning}>{warning}</small>)}
      </div>
    </section>}

    <section style={{ marginTop: 12, padding: 10, borderRadius: 9, background: "#eef3df", border: "1px solid #b9aa91" }}>
      <strong>{t("architecture.review.strategy")}</strong>
      <div style={{ display: "grid", gap: 4, marginTop: 6, fontSize: 12 }}>
        <span>{t("architecture.review.strategyScore", { score: Math.round(props.review.strategic.summary.total) })}</span>
        <span>{t("architecture.review.fairness", { score: Math.round(props.review.strategic.summary.fairnessFloor) })} · {t("architecture.review.options", { count: Math.round(props.review.strategic.summary.genuineChoice / 33) })}</span>
        <span>{t("architecture.review.rotation", { score: Math.round(props.review.strategic.summary.opportunityRotation) })}</span>
      </div>
    </section>

    <section data-testid="architecture-rules-feedback" style={{ marginTop: 12, padding: 10, borderRadius: 9, background: "#f7efe0", border: "1px solid #b9aa91" }}>
      <strong>{t("architecture.review.rules.title")}</strong>
      <div style={{ display: "flex", gap: 8, marginTop: 6, fontSize: 12 }}>
        <span>{t("architecture.review.rules.penalties", { count: props.review.rules.penaltyCount })}</span>
        <span>{t("architecture.review.rules.recoveries", { count: props.review.rules.recoveryAttemptCount })}</span>
        <span>{t("architecture.review.rules.reliefs", { count: props.review.rules.reliefResolvedCount })}</span>
      </div>
      {props.review.rules.feedback.length > 0 && <div style={{ display: "grid", gap: 5, marginTop: 7, fontSize: 12 }}>{props.review.rules.feedback.slice(0, 4).map((item) => <p key={item.id} style={{ margin: 0, color: item.level === "warning" ? "#8a3427" : "#495c43" }}>{item.message}</p>)}</div>}
    </section>

    {props.review.selectedStrategicHole && <section style={{ marginTop: 12 }}>
      <strong>{t("architecture.review.matrix")}</strong>
      <div style={{ display: "grid", gap: 5, marginTop: 6 }}>
        {props.review.selectedStrategicHole.cohorts.map((cohort) => <button key={cohort.cohortId} onClick={() => {
          const option = props.review.selectedStrategicHole?.options.find((candidate) => candidate.kind === cohort.preferredOption);
          if (option) props.onJump(option.location, props.review.selectedStrategicHole?.holeId);
        }} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 7, alignItems: "center", textAlign: "left", background: "#fffdf6" }}>
          <span>{cohort.cohortId}</span><span>{Math.round(cohort.viability)}%</span><b>{cohort.expectedStrokes.toFixed(2)}</b>
        </button>)}
      </div>
    </section>}

    <section style={{ marginTop: 12 }}>
      <strong>{t("architecture.review.recommendations")}</strong>
      {props.review.recommendations.length ? <div style={{ display: "grid", gap: 6, marginTop: 6 }}>{props.review.recommendations.slice(0, 5).map((recommendation) => <div key={recommendation.id} style={{ padding: 8, background: "#fffdf6", border: "1px solid #c8b999", borderRadius: 7 }}>
        <b>{t(recommendation.titleKey as MessageKey)}</b>
        <p style={{ margin: "4px 0", fontSize: 12 }}>{t(recommendation.detailKey as MessageKey)}</p>
        <button onClick={() => props.onJump(recommendation.location, recommendation.holeId)}>{t("architecture.review.recommendationLocation")}</button>
      </div>)}</div> : <p style={{ fontSize: 12 }}>{t("architecture.review.noRecommendations")}</p>}
    </section>

    {props.review.scoring.length > 0 && <section style={{ marginTop: 12 }}>
      <strong>{t("architecture.review.teeScoring")}</strong>
      <div style={{ display: "grid", gap: 4, marginTop: 5 }}>{props.review.scoring.map((item) => <div key={item.teeSet} style={{ display: "flex", justifyContent: "space-between" }}><span>{item.teeSet} · {t("architecture.review.rounds", { count: item.rounds })}</span><b>{item.averageToPar > 0 ? "+" : ""}{item.averageToPar}</b></div>)}</div>
    </section>}

    <section style={{ marginTop: 12 }}>
      <strong>{t("architecture.review.compare")}</strong>
      {props.review.revisions.length < 2
        ? <p style={{ fontSize: 12 }}>{t("architecture.review.compareEmpty")}</p>
        : <>
          <label style={{ display: "grid", marginTop: 5 }}>{t("architecture.review.before")}<select data-testid="architecture-revision-compare" value={comparisonId} onChange={(event) => setComparisonId(event.target.value)}>{props.review.revisions.filter((revision) => revision.id !== currentRevision?.id).map((revision) => <option key={revision.id} value={revision.id}>{t("architecture.review.revision", { week: revision.lastWeek, shots: revision.shots })}</option>)}</select></label>
          {selectedRevision && <div data-testid="architecture-comparison" style={{ marginTop: 7, display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 8, fontSize: 12 }}>
            <span>{selectedRevision.averageToPar > 0 ? "+" : ""}{selectedRevision.averageToPar}<small style={{ display: "block" }}>{selectedRevision.shots} {t("architecture.review.shots")}</small></span>
            <b>→</b>
            <span>{currentRevision ? `${currentRevision.averageToPar > 0 ? "+" : ""}${currentRevision.averageToPar}` : t("architecture.review.awaiting")}<small style={{ display: "block" }}>{currentRevision?.shots ?? 0} {t("architecture.review.shots")}</small></span>
          </div>}
        </>}
    </section>

    <section data-testid="architecture-strategic-comparison" style={{ marginTop: 12, padding: 10, borderRadius: 9, background: "#f0e9dc", border: "1px solid #b9aa91" }}>
      <strong>{t("architecture.review.testComparison")}</strong>
      {!strategicComparison
        ? <p style={{ margin: "5px 0 0", fontSize: 12 }}>{t("architecture.review.testComparisonEmpty")}</p>
        : <>
          <div style={{ display: "grid", gap: 4, marginTop: 6, fontSize: 12 }}>
            <span>{t("architecture.review.testEvidence", { state: strategicComparison.evidenceLabel === "current" ? t("architecture.review.current") : t("architecture.review.provisional") })}</span>
            <span>{t("architecture.review.testGeometry", { before: strategicComparison.beforeGeometryVersion, after: strategicComparison.afterGeometryVersion })}</span>
            <span>{t("architecture.review.testFairnessDelta", { delta: signed(strategicComparison.fairnessFloorDelta) })} · {t("architecture.review.testOptionDelta", { delta: signed(strategicComparison.optionCountDelta) })}</span>
            <span>{t("architecture.review.testSafeDelta", { delta: signed(strategicComparison.safeRouteViabilityDelta) })} · {t("architecture.review.testSeparationDelta", { delta: signed(strategicComparison.strategicSeparationDelta) })}</span>
            {strategicComparison.excludedCohorts.length > 0 && <span>{t("architecture.review.testExcluded", { cohorts: strategicComparison.excludedCohorts.join(", ") })}</span>}
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 12 }}>{strategicComparison.explanation}</p>
        </>}
    </section>

    {props.review.evidence.length > 0 && <section style={{ marginTop: 12 }}>
      <strong>{t("architecture.review.recentEvidence")}</strong>
      <div style={{ display: "grid", gap: 5, marginTop: 5 }}>{props.review.evidence.slice(-6).reverse().map((item) => <button
        key={item.id}
        data-current={item.geometryVersion === props.review.currentGeometryVersion}
        onClick={() => props.onJump(item.rest, item.holeId)}
        style={{ textAlign: "left", display: "grid", gridTemplateColumns: "1fr auto", gap: 8, background: item.id === props.review.selectedTraceId ? "#fff1a8" : "#fffdf6" }}
      ><span><b>{item.golferName}</b> · {item.holeId} · {item.shotType}</span><small>{item.geometryVersion === props.review.currentGeometryVersion ? t("architecture.review.current") : t("architecture.review.historical")}</small></button>)}</div>
    </section>}

    <div style={{ display: "flex", gap: 7, marginTop: 12 }}>
      <button data-testid="architecture-practice-round" onClick={() => {
        void props.onPracticeRound(props.review.filters.courseId).then((reason) => setMessage(reason ?? t("architecture.review.practiceStarted")));
      }}>{t("architecture.review.practice")}</button>
      {message && <span role="status" style={{ fontSize: 12 }}>{message}</span>}
    </div>
  </aside>;
}

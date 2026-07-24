import { useMemo, useState } from "react";
import type { Course } from "../game/models/types";
import type { ArchitectureReviewData, ArchitectureReviewFilters } from "../game/architecture/review";
import type { ArchitectureOverlayKind } from "../game/architecture/reviewTypes";
import { courseLayouts } from "../game/models/courseLayouts";
import { useI18n } from "../i18n/useI18n";
import type { MessageKey } from "../i18n/catalog";

const OVERLAYS: ArchitectureOverlayKind[] = [
  "traces", "dispersion", "heatmap", "recovery", "scoring", "hazards", "walking", "congestion",
];

export function ArchitectureReviewPanel(props: {
  course: Course;
  review: ArchitectureReviewData;
  onFilters: (filters: ArchitectureReviewFilters) => void;
  onJump: (point: { x: number; y: number }, holeId?: string) => void;
  onPracticeRound: (courseId: string) => string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [message, setMessage] = useState("");
  const [comparisonId, setComparisonId] = useState(props.review.revisions[1]?.id ?? "");
  const selectedRevision = props.review.revisions.find((revision) => revision.id === comparisonId);
  const currentRevision = props.review.revisions.find((revision) => revision.geometryVersion === props.review.currentGeometryVersion);
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

    <nav aria-label={t("architecture.review.overlays")} style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 5, margin: "12px 0" }}>
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
      <label>{t("architecture.review.segment")}<select value={props.review.filters.sourceSegment} onChange={(event) => set("sourceSegment", event.target.value)}><option value="all">{t("architecture.review.all")}</option>{props.review.sourceSegments.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label style={{ gridColumn: "1 / -1" }}>{t("architecture.review.evidenceAge")}<select data-testid="architecture-age-filter" value={props.review.filters.recency} onChange={(event) => set("recency", event.target.value as ArchitectureReviewFilters["recency"])}>{(["current", "recent", "historical", "all"] as const).map((value) => <option value={value} key={value}>{t(`architecture.review.age.${value}` as MessageKey)}</option>)}</select></label>
    </div>

    <section data-status={props.review.status} style={{ marginTop: 11, padding: 10, borderRadius: 9, background: props.review.status === "ready" ? "#e0efdf" : props.review.status === "stale-only" ? "#f8e3b8" : "#fff7e6", border: "1px solid #b9aa91" }}>
      <strong>{t(`architecture.review.status.${props.review.status}` as MessageKey)}</strong>
      <p style={{ margin: "5px 0 0", fontSize: 12 }}>{props.review.explanation}</p>
      <div style={{ display: "flex", gap: 12, marginTop: 7, fontSize: 12 }}>
        <span>{t("architecture.review.currentCount", { count: props.review.currentEvidence })}</span>
        <span>{t("architecture.review.historicalCount", { count: props.review.historicalEvidence })}</span>
      </div>
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
        const reason = props.onPracticeRound(props.review.filters.courseId);
        setMessage(reason ?? t("architecture.review.practiceStarted"));
      }}>{t("architecture.review.practice")}</button>
      {message && <span role="status" style={{ fontSize: 12 }}>{message}</span>}
    </div>
  </aside>;
}

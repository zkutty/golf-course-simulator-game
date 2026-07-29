import { useState, type CSSProperties } from "react";
import type { MessageKey } from "../i18n/catalog";
import { translateCurrent } from "../i18n/core";

export type InspectorFocus = "course" | "operations" | "property" | "people" | "legacy";

type FocusCopy = {
  label: MessageKey;
  title: MessageKey;
  description: MessageKey;
};

const FOCUS_COPY: Record<InspectorFocus, FocusCopy> = {
  course: {
    label: "inspector.focus.course",
    title: "inspector.course.title",
    description: "inspector.course.description",
  },
  operations: {
    label: "inspector.focus.operations",
    title: "inspector.operations.title",
    description: "inspector.operations.description",
  },
  property: {
    label: "inspector.focus.property",
    title: "inspector.property.title",
    description: "inspector.property.description",
  },
  people: {
    label: "inspector.focus.people",
    title: "inspector.people.title",
    description: "inspector.people.description",
  },
  legacy: {
    label: "inspector.focus.legacy",
    title: "inspector.legacy.title",
    description: "inspector.legacy.description",
  },
};

const FOCUS_ORDER: InspectorFocus[] = ["course", "operations", "property", "people", "legacy"];

const panelStyle: CSSProperties = {
  position: "absolute",
  zIndex: 1250,
  top: 70,
  right: 16,
  width: "min(360px, calc(100vw - 32px))",
  maxHeight: "calc(100vh - 88px)",
  overflow: "auto",
  padding: 14,
  border: "1px solid rgba(54, 72, 53, .24)",
  borderRadius: 16,
  background: "rgba(255, 253, 246, .98)",
  boxShadow: "0 18px 48px rgba(30, 48, 31, .28)",
  color: "#334438",
};

const buttonStyle: CSSProperties = {
  border: "1px solid rgba(54, 72, 53, .2)",
  borderRadius: 9,
  background: "#fff",
  color: "#334438",
  padding: "7px 9px",
  fontSize: 11,
  fontWeight: 800,
  cursor: "pointer",
};

function Metric(props: { label: string; value: string }) {
  return (
    <div style={{ padding: 8, borderRadius: 9, background: "#f2f6ed", border: "1px solid #dbe6d2" }}>
      <div style={{ fontSize: 9, letterSpacing: ".08em", textTransform: "uppercase", color: "#70806d" }}>{props.label}</div>
      <div style={{ marginTop: 3, fontSize: 16, fontWeight: 900 }}>{props.value}</div>
    </div>
  );
}

export function ContextualInspectorPanel(props: {
  initialFocus?: InspectorFocus;
  courseName: string;
  selectedTerrain: string;
  validHoles: number;
  condition: number;
  cash: string;
  reputation: number;
  week: number;
  golfers: number;
  openComplaints: number;
  playerRound: string;
  onOpenCourses: () => void;
  onOpenLive: () => void;
  onOpenProperty: () => void;
  onOpenPeople: () => void;
  onOpenLegacy: () => void;
  onSetViewMode: (mode: "COZY" | "ARCHITECT") => void;
  onSetPacePreset: (preset: "relaxed" | "balanced" | "brisk") => void;
  onClose: () => void;
}) {
  const [focus, setFocus] = useState<InspectorFocus>(props.initialFocus ?? "course");
  const copy = FOCUS_COPY[focus];
  const openers: Record<InspectorFocus, () => void> = {
    course: props.onOpenCourses,
    operations: props.onOpenLive,
    property: props.onOpenProperty,
    people: props.onOpenPeople,
    legacy: props.onOpenLegacy,
  };

  return (
    <section role="dialog" aria-modal="false" aria-labelledby="contextual-inspector-title" aria-describedby="contextual-inspector-description" data-testid="contextual-inspector" style={panelStyle}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 10 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "#71806e", fontWeight: 900 }}>{translateCurrent("inspector.eyebrow")}</div>
          <h2 id="contextual-inspector-title" style={{ margin: "3px 0 4px", fontSize: 20 }}>{translateCurrent(copy.title)}</h2>
          <p id="contextual-inspector-description" style={{ margin: 0, fontSize: 11, lineHeight: 1.45, color: "#667266" }}>{translateCurrent(copy.description)}</p>
        </div>
        <button aria-label={translateCurrent("inspector.close")} onClick={props.onClose} style={{ ...buttonStyle, padding: "5px 8px", fontSize: 15 }}>×</button>
      </header>

      <div role="tablist" aria-label={translateCurrent("inspector.focus.aria")} style={{ display: "flex", gap: 5, margin: "13px 0 12px", flexWrap: "wrap" }}>
        {FOCUS_ORDER.map((candidate) => (
          <button
            key={candidate}
            role="tab"
            aria-selected={focus === candidate}
            onClick={() => setFocus(candidate)}
            style={{ ...buttonStyle, background: focus === candidate ? "#3f6c43" : "#fff", color: focus === candidate ? "#fff" : "#334438" }}
          >
            {translateCurrent(FOCUS_COPY[candidate].label)}
          </button>
        ))}
      </div>

      {focus === "course" && <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          <Metric label={translateCurrent("inspector.metric.course")} value={props.courseName} />
          <Metric label={translateCurrent("inspector.metric.holes")} value={`${props.validHoles}/9`} />
          <Metric label={translateCurrent("inspector.metric.condition")} value={`${Math.round(props.condition * 100)}%`} />
        </div>
        <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: "#fff8e7", border: "1px solid #ead9ad" }}>
          <strong style={{ fontSize: 11 }}>{translateCurrent("inspector.recommendation.course")}</strong>
          <div style={{ marginTop: 4, fontSize: 11, color: "#6b6555" }}>{translateCurrent("inspector.course.selected", { terrain: props.selectedTerrain })}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            <button onClick={() => props.onSetViewMode("COZY")} style={buttonStyle}>{translateCurrent("inspector.preset.cozy")}</button>
            <button onClick={() => props.onSetViewMode("ARCHITECT")} style={buttonStyle}>{translateCurrent("inspector.preset.architect")}</button>
          </div>
        </div>
      </>}

      {focus === "operations" && <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          <Metric label={translateCurrent("inspector.metric.cash")} value={props.cash} />
          <Metric label={translateCurrent("inspector.metric.reputation")} value={`${props.reputation}/100`} />
          <Metric label={translateCurrent("inspector.metric.week")} value={String(props.week)} />
        </div>
        <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: "#eef5ee", border: "1px solid #d2e2d2" }}>
          <strong style={{ fontSize: 11 }}>{translateCurrent("inspector.recommendation.operations")}</strong>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            <button onClick={() => props.onSetPacePreset("relaxed")} style={buttonStyle}>{translateCurrent("inspector.preset.relaxed")}</button>
            <button onClick={() => props.onSetPacePreset("balanced")} style={buttonStyle}>{translateCurrent("inspector.preset.balanced")}</button>
            <button onClick={() => props.onSetPacePreset("brisk")} style={buttonStyle}>{translateCurrent("inspector.preset.brisk")}</button>
          </div>
        </div>
      </>}

      {focus === "property" && <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          <Metric label={translateCurrent("inspector.metric.cash")} value={props.cash} />
          <Metric label={translateCurrent("inspector.metric.golfers")} value={String(props.golfers)} />
          <Metric label={translateCurrent("inspector.metric.complaints")} value={String(props.openComplaints)} />
        </div>
        <p style={{ margin: "12px 0 0", fontSize: 11, color: "#667266" }}>{translateCurrent("inspector.property.summary")}</p>
      </>}

      {focus === "people" && <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
          <Metric label={translateCurrent("inspector.metric.golfers")} value={String(props.golfers)} />
          <Metric label={translateCurrent("inspector.metric.reputation")} value={`${props.reputation}/100`} />
        </div>
        <p style={{ margin: "12px 0 0", fontSize: 11, color: "#667266" }}>{translateCurrent("inspector.people.summary")}</p>
      </>}

      {focus === "legacy" && <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
          <Metric label={translateCurrent("inspector.metric.week")} value={String(props.week)} />
          <Metric label={translateCurrent("inspector.metric.playerRound")} value={props.playerRound} />
        </div>
        <p style={{ margin: "12px 0 0", fontSize: 11, color: "#667266" }}>{translateCurrent("inspector.legacy.summary")}</p>
      </>}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 14, paddingTop: 10, borderTop: "1px solid #e3e6dc" }}>
        <span style={{ alignSelf: "center", fontSize: 10, color: "#71806e" }}>{translateCurrent("inspector.advancedHint")}</span>
        <button onClick={openers[focus]} style={{ ...buttonStyle, background: "#334438", color: "#fff" }}>{translateCurrent("inspector.openDetails")}</button>
      </div>
    </section>
  );
}

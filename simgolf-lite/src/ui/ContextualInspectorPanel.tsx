import { useState, type CSSProperties } from "react";
import { IconUi } from "../assets/icons";
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
  boxSizing: "border-box",
  width: "min(360px, calc(100% - 32px))",
  maxHeight: "calc(100vh - 88px)",
  overflow: "auto",
  padding: 14,
  border: "1px solid var(--ui-state-border)",
  borderRadius: 16,
  background: "var(--ui-surface-raised)",
  boxShadow: "var(--ui-shadow-elevated)",
  color: "var(--ui-text)",
};

const buttonStyle: CSSProperties = {
  border: "1px solid var(--ui-state-border)",
  borderRadius: 9,
  background: "var(--ui-action-surface)",
  color: "var(--ui-action-text)",
  padding: "7px 9px",
  fontSize: 11,
  fontWeight: 800,
  cursor: "pointer",
};

function Metric(props: { label: string; value: string }) {
  return (
    <div className="cc-inspector-metric" style={{ padding: 8, borderRadius: 9 }}>
      <div className="cc-inspector-metric-label" style={{ fontSize: 9, letterSpacing: ".08em", textTransform: "uppercase" }}>{props.label}</div>
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
    <section className="cc-contextual-inspector" role="dialog" aria-modal="false" aria-labelledby="contextual-inspector-title" aria-describedby="contextual-inspector-description" data-testid="contextual-inspector" style={panelStyle}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 10 }}>
        <div>
          <div className="cc-inspector-eyebrow" style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", fontWeight: 900 }}>{translateCurrent("inspector.eyebrow")}</div>
          <h2 id="contextual-inspector-title" style={{ margin: "3px 0 4px", fontSize: 20 }}>{translateCurrent(copy.title)}</h2>
          <p id="contextual-inspector-description" className="cc-inspector-muted" style={{ margin: 0, fontSize: 11, lineHeight: 1.45 }}>{translateCurrent(copy.description)}</p>
        </div>
        <button className="cc-inspector-icon-button" aria-label={translateCurrent("inspector.close")} onClick={props.onClose} style={{ ...buttonStyle, padding: "5px 8px" }}><IconUi name="close" /></button>
      </header>

      <div role="tablist" aria-label={translateCurrent("inspector.focus.aria")} style={{ display: "flex", gap: 5, margin: "13px 0 12px", flexWrap: "wrap" }}>
        {FOCUS_ORDER.map((candidate) => (
          <button
            key={candidate}
            id={`contextual-inspector-tab-${candidate}`}
            role="tab"
            aria-selected={focus === candidate}
            aria-controls="contextual-inspector-content"
            onClick={() => setFocus(candidate)}
            className="cc-inspector-tab"
            data-active={focus === candidate}
            style={buttonStyle}
          >
            {translateCurrent(FOCUS_COPY[candidate].label)}
          </button>
        ))}
      </div>

      <div id="contextual-inspector-content" role="tabpanel" aria-labelledby={`contextual-inspector-tab-${focus}`} tabIndex={0}>
      {focus === "course" && <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          <Metric label={translateCurrent("inspector.metric.course")} value={props.courseName} />
          <Metric label={translateCurrent("inspector.metric.holes")} value={`${props.validHoles}/9`} />
          <Metric label={translateCurrent("inspector.metric.condition")} value={`${Math.round(props.condition * 100)}%`} />
        </div>
        <div className="cc-inspector-recommendation" data-tone="advisory" style={{ marginTop: 12, padding: 10, borderRadius: 10 }}>
          <strong style={{ fontSize: 11 }}>{translateCurrent("inspector.recommendation.course")}</strong>
          <div className="cc-inspector-recommendation-copy" style={{ marginTop: 4, fontSize: 11 }}>{translateCurrent("inspector.course.selected", { terrain: props.selectedTerrain })}</div>
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
        <div className="cc-inspector-recommendation" data-tone="positive" style={{ marginTop: 12, padding: 10, borderRadius: 10 }}>
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
        <p className="cc-inspector-muted" style={{ margin: "12px 0 0", fontSize: 11 }}>{translateCurrent("inspector.property.summary")}</p>
      </>}

      {focus === "people" && <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
          <Metric label={translateCurrent("inspector.metric.golfers")} value={String(props.golfers)} />
          <Metric label={translateCurrent("inspector.metric.reputation")} value={`${props.reputation}/100`} />
        </div>
        <p className="cc-inspector-muted" style={{ margin: "12px 0 0", fontSize: 11 }}>{translateCurrent("inspector.people.summary")}</p>
      </>}

      {focus === "legacy" && <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
          <Metric label={translateCurrent("inspector.metric.week")} value={String(props.week)} />
          <Metric label={translateCurrent("inspector.metric.playerRound")} value={props.playerRound} />
        </div>
        <p className="cc-inspector-muted" style={{ margin: "12px 0 0", fontSize: 11 }}>{translateCurrent("inspector.legacy.summary")}</p>
      </>}

      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 14, paddingTop: 10, borderTop: "1px solid #e3e6dc" }}>
        <span className="cc-inspector-eyebrow" style={{ alignSelf: "center", fontSize: 10 }}>{translateCurrent("inspector.advancedHint")}</span>
        <button className="cc-inspector-primary-action" onClick={openers[focus]} style={buttonStyle}>{translateCurrent("inspector.openDetails")}</button>
      </div>
    </section>
  );
}

import { useMemo, useState } from "react";
import type { Course, World } from "../game/models/types";
import {
  CHARTER_DEFINITIONS,
  activeWeather,
  applySeasonCommand,
  formatClubDate,
  previewSeasonCommand,
  seasonalState,
  weatherModifiers,
} from "../game/seasons/seasons";
import {
  CLUB_CHARTERS,
  type AutomationPreset,
  type ClubCharter,
  type SeasonCommand,
  type TurfPriority,
  type WaterPolicy,
} from "../game/seasons/types";
import { systemControlEnvelope } from "../game/experience/systemControl";
import {
  systemControlCommandMessage,
  systemControlDecisionLabel,
  systemControlProfileLabel,
  systemControlStatusLabel,
} from "./systemControlPresentation";
import { formatCurrency } from "../i18n/format";
import { translateCurrent } from "../i18n/core";
import {
  normalizeSurfaceCareState,
  observedSurfaceCareEvidence,
  quoteSurfaceRepair,
  surfaceCareConditionSummary,
} from "../game/conditions/surfaceCare";
import type { SurfaceRepairKind } from "../game/models/types";
import {
  biomeContextAttributes,
  type BiomeContextSurface,
  type BiomeStatusTone,
  type BiomeUiTheme,
} from "./biomeUiTheme";

const TURF_PRIORITIES: TurfPriority[] = ["playability", "recovery", "presentation"];
const WATER_POLICIES: WaterPolicy[] = ["conserve", "balanced", "irrigate"];

const card = {
  border: "1px solid #c8b98e",
  borderRadius: 10,
  background: "rgba(255,253,244,.9)",
  padding: 10,
} as const;

const button = {
  border: "1px solid #6c5a32",
  borderRadius: 7,
  background: "#f8efd2",
  color: "#332b1d",
  padding: "7px 9px",
  fontWeight: 800,
  cursor: "pointer",
} as const;

function percent(value: number) {
  const rounded = Math.round((value - 1) * 100);
  return `${rounded >= 0 ? "+" : ""}${rounded}%`;
}

export function SeasonsLegacyPanel(props: {
  course: Course;
  world: World;
  day: number;
  onCommand: (command: SeasonCommand) => ReturnType<typeof applySeasonCommand>;
  onSurfaceRepair: (
    key: string,
    kind: SurfaceRepairKind,
    absoluteDay: number,
  ) => void;
  onClose: () => void;
  biomeContext?: BiomeUiTheme;
}) {
  const [tab, setTab] = useState<"season" | "identity" | "legacy">("season");
  const [message, setMessage] = useState<string | null>(null);
  const state = useMemo(() => seasonalState(props.world, props.course, props.day), [props.course, props.day, props.world]);
  const control = useMemo(() => systemControlEnvelope(props.world), [props.world]);
  const full = (id: "localized-turf" | "irrigation" | "drainage") => control.systems.find((system) => system.id === id)?.visibility === "full";
  const turfDetail = full("localized-turf");
  const irrigationDetail = full("irrigation");
  const drainageDetail = full("drainage");
  const weather = activeWeather(props.world, props.course, props.day);
  const modifiers = weatherModifiers(weather, state.operations.drainageLevel);
  const careEvidence = useMemo(
    () => observedSurfaceCareEvidence(props.course).slice(0, 8),
    [props.course],
  );
  const careState = useMemo(
    () => normalizeSurfaceCareState(props.course.surfaceCare, props.course),
    [props.course],
  );
  const careSummary = useMemo(
    () => surfaceCareConditionSummary(props.course),
    [props.course],
  );
  const run = (command: SeasonCommand) => {
    const result = props.onCommand(command);
    setMessage(systemControlCommandMessage(result.message));
  };
  const charterCost = (charter: ClubCharter) => previewSeasonCommand(props.course, props.world, {
    type: "SELECT_CHARTER",
    charter,
    confirmed: true,
  });
  const contextAttributes = (
    surface: BiomeContextSurface,
    status: BiomeStatusTone = "neutral",
  ) => props.biomeContext
    ? biomeContextAttributes(props.biomeContext, surface, status)
    : {};

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby="season-legacy-title"
      data-testid="seasons-legacy-panel"
      {...(props.biomeContext
        ? biomeContextAttributes(props.biomeContext, "seasons-legacy")
        : {})}
      style={{ position: "absolute", zIndex: 205, top: 58, right: 14, width: "min(620px,calc(100% - 28px))", maxHeight: "calc(100% - 86px)", overflow: "auto", border: "3px solid #755824", borderRadius: 14, background: "linear-gradient(145deg,#fbf1d0,#dbe7cf)", color: "#302819", boxShadow: "0 20px 55px rgba(0,0,0,.45)", padding: 14 }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
        <div>
          <small style={{ textTransform: "uppercase", letterSpacing: ".11em", fontWeight: 900 }}>{translateCurrent("season.eyebrow")}</small>
          <h2 id="season-legacy-title" style={{ margin: "2px 0" }}>{translateCurrent("season.title")}</h2>
          <div data-testid="club-calendar-date">{formatClubDate(state.calendar)}</div>
          <span
            aria-hidden="true"
            data-testid="biome-supporting-illustration"
            {...contextAttributes("supporting-illustration")}
          />
        </div>
        <button aria-label={translateCurrent("common.close")} onClick={props.onClose} style={button}>×</button>
      </header>

      <nav aria-label={translateCurrent("season.tabs")} style={{ display: "flex", gap: 6, margin: "12px 0" }}>
        {(["season", "identity", "legacy"] as const).map((id) => (
          <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)} style={{ ...button, background: tab === id ? "#49634b" : button.background, color: tab === id ? "white" : button.color }}>
            {translateCurrent(`season.tab.${id}`)}
          </button>
        ))}
      </nav>
      {message && <div role="status" style={{ ...card, marginBottom: 10, background: "#e8efd9" }}>{message}</div>}

      {tab === "season" && <div style={{ display: "grid", gap: 10 }}>
        <section style={card}>
          <h3 style={{ margin: "0 0 7px" }}>{translateCurrent("season.weather.current")}</h3>
          <strong data-testid="current-weather">{translateCurrent("season.weather.summary", {
            kind: weather.kind.replaceAll("_", " "),
            temperature: weather.temperatureF,
            wind: weather.windMph,
            rain: weather.rainInches.toFixed(2),
          })}</strong>
          <div style={{ marginTop: 6, fontSize: 12 }}>{translateCurrent("season.weather.effects", {
            carry: percent(modifiers.carryMultiplier),
            dispersion: percent(modifiers.dispersionMultiplier),
            demand: percent(modifiers.demandMultiplier),
            pace: percent(modifiers.paceMultiplier),
            wear: percent(modifiers.turfWearMultiplier),
          })}</div>
        </section>
        {turfDetail && careEvidence.length > 0 && <section
          style={card}
          data-testid="surface-care-operations"
          {...contextAttributes(
            "condition-report",
            careSummary.repairRequiredZones > 0 ? "warning" : "neutral",
          )}
        >
          <h3 style={{ margin: "0 0 7px" }}>{translateCurrent("season.surfaceCare.title")}</h3>
          <div style={{ fontSize: 12, marginBottom: 7 }}>
            {translateCurrent("season.surfaceCare.summary", {
              condition: Math.round(careSummary.overallCondition * 100),
              readiness: Math.round(careSummary.tournamentReadiness * 100),
              repairs: careSummary.repairRequiredZones,
            })}
          </div>
          <div style={{ display: "grid", gap: 7 }}>
            {careEvidence.map((zone) => {
              const activeRepair = careState?.records[zone.key]?.repair;
              return <article key={zone.key} data-testid={`surface-care-${zone.key}`} style={{ borderTop: "1px solid #d6c99f", paddingTop: 6 }}>
                <strong>{translateCurrent("season.surfaceCare.zone", {
                  terrain: zone.terrain.replaceAll("_", " "),
                  x: zone.cellX,
                  y: zone.cellY,
                })}</strong>
                <div style={{ fontSize: 12 }}>
                  {translateCurrent("season.surfaceCare.metrics", {
                    turf: Math.round(zone.turfHealth * 100),
                    mowing: Math.round(zone.mowingQuality * 100),
                    service: Math.round(zone.serviceRatio * 100),
                  })}
                </div>
                <small>{zone.action}</small>
                {activeRepair
                  ? <div data-testid={`surface-repair-active-${zone.key}`} style={{ marginTop: 4 }}>
                    {translateCurrent("season.surfaceCare.activeRepair", {
                      kind: translateCurrent(`season.surfaceCare.kind.${activeRepair.kind}`),
                      progress: activeRepair.progressDays.toFixed(1),
                      days: activeRepair.requiredDays,
                    })}
                  </div>
                  : zone.repairRequired && <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
                    {(["reseed", "resod"] as const).map((kind) => {
                      const quote = quoteSurfaceRepair(
                        props.course,
                        props.world,
                        zone.key,
                        kind,
                      );
                      if (!quote) return null;
                      const disabled = props.world.cash < quote.cost;
                      return <button
                        key={kind}
                        data-testid={`${kind}-${zone.key}`}
                        disabled={disabled}
                        title={disabled ? translateCurrent("season.surfaceCare.insufficientCash") : undefined}
                        onClick={() => {
                          props.onSurfaceRepair(zone.key, kind, state.calendar.absoluteDay);
                          setMessage(translateCurrent("season.surfaceCare.scheduled", {
                            kind: translateCurrent(`season.surfaceCare.kind.${kind}`),
                            terrain: zone.terrain.replaceAll("_", " "),
                            x: zone.cellX,
                            y: zone.cellY,
                          }));
                        }}
                        style={button}
                      >
                        {translateCurrent("season.surfaceCare.repairButton", {
                          kind,
                          cost: formatCurrency(quote.cost),
                          days: quote.requiredDays,
                        })}
                      </button>;
                    })}
                  </div>}
              </article>;
            })}
          </div>
        </section>}
        <section style={card}>
          <h3 style={{ margin: "0 0 7px" }}>{translateCurrent("season.forecast.title")}</h3>
          <div data-testid="seven-day-forecast" style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(62px,1fr))", gap: 5, overflowX: "auto" }}>
            {state.forecast.map((day, index) => <div key={day.absoluteDay} style={{ border: "1px solid #d6c99f", borderRadius: 7, padding: 6, minWidth: 62, background: day.severity >= .55 ? "#f0cfb9" : "#f7f1da" }}>
              <strong>{translateCurrent("season.forecast.day", { day: index + 1 })}</strong>
              <div>{day.kind.replaceAll("_", " ")}</div>
              <small>{day.temperatureF}° · {day.windMph}</small>
            </div>)}
          </div>
        </section>
        <section style={card}>
          <h3 style={{ margin: "0 0 7px" }}>{translateCurrent("season.response.title")}</h3>
          <div style={{ display: "grid", gap: 8 }}>
            {turfDetail && <label>{translateCurrent("season.response.turf")}<select data-testid="turf-priority" value={state.operations.turfPriority} onChange={(event) => run({ type: "SET_TURF_PRIORITY", priority: event.target.value as TurfPriority })}>{TURF_PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}</select></label>}
            {irrigationDetail && <label>{translateCurrent("season.response.water")}<select data-testid="water-policy" value={state.operations.waterPolicy} onChange={(event) => run({ type: "SET_WATER_POLICY", policy: event.target.value as WaterPolicy })}>{WATER_POLICIES.map((policy) => <option key={policy}>{policy}</option>)}</select></label>}
            {drainageDetail && (() => {
              const preview = previewSeasonCommand(props.course, props.world, { type: "IMPROVE_DRAINAGE" });
              return <div>
                <strong>{translateCurrent("season.response.drainage", { level: state.operations.drainageLevel })}</strong>
                <div>{translateCurrent("season.response.preview", { cost: formatCurrency(preview.cost), days: preview.days, risk: Math.round(preview.riskReduction * 100) })}</div>
                <button data-testid="improve-drainage" disabled={!preview.ok} onClick={() => run({ type: "IMPROVE_DRAINAGE" })} style={button}>{translateCurrent("season.response.improve")}</button>
                {!preview.ok && <small style={{ display: "block", color: "#8b3328" }}>{preview.blockers.join(" ")}</small>}
              </div>;
            })()}
            <div style={{ display: "grid", gap: 5 }}>
              {props.course.layouts?.map((layout) => {
                const closed = layout.state === "closed";
                const preview = previewSeasonCommand(props.course, props.world, { type: "SET_COURSE_CLOSED", courseId: layout.id, closed: !closed, currentDay: props.day });
                return <div key={layout.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span>{layout.name} · {translateCurrent(closed ? "season.response.closed" : "season.response.open")}</span>
                  <button disabled={!preview.ok} onClick={() => run({ type: "SET_COURSE_CLOSED", courseId: layout.id, closed: !closed, currentDay: props.day })} style={button}>{translateCurrent(closed ? "season.response.reopen" : "season.response.close")}</button>
                </div>;
              })}
            </div>
          </div>
        </section>
      </div>}

      {tab === "identity" && <div style={{ display: "grid", gap: 10 }}>
        <section style={card}>
          <h3 style={{ margin: "0 0 8px" }}>{translateCurrent("season.charter.title")}</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 8 }}>
            {CLUB_CHARTERS.map((charter) => {
              const definition = CHARTER_DEFINITIONS[charter];
              const preview = charterCost(charter);
              const selected = state.charter === charter;
              return <article key={charter} data-testid={`charter-${charter}`} style={{ ...card, border: selected ? "2px solid #426143" : card.border }}>
                <strong>{definition.name}</strong>
                <p style={{ margin: "5px 0" }}>{definition.promise}</p>
                <small>{definition.tradeoff}</small>
                <div style={{ marginTop: 5 }}>{translateCurrent("season.charter.cost", { cost: formatCurrency(preview.cost) })}</div>
                <button disabled={selected || !preview.ok} onClick={() => run({ type: "SELECT_CHARTER", charter, confirmed: true })} style={{ ...button, marginTop: 6 }}>{translateCurrent(selected ? "season.charter.selected" : "season.charter.adopt")}</button>
                {!preview.ok && !selected && <small style={{ display: "block", color: "#8b3328" }}>{preview.blockers.join(" ")}</small>}
              </article>;
            })}
          </div>
        </section>
        <section style={card}>
          <h3 style={{ margin: "0 0 8px" }}>{translateCurrent("season.automation.title")}</h3>
          <label>{translateCurrent("season.automation.preset")}<select data-testid="automation-preset" value={state.automation.preset} onChange={(event) => run({ type: "SET_AUTOMATION", preset: event.target.value as AutomationPreset })}>{(["stewardship", "balanced", "growth"] as AutomationPreset[]).map((preset) => <option key={preset} value={preset}>{translateCurrent(`season.automation.presetValue.${preset}`)}</option>)}</select></label>
          <div data-testid="system-control-summary" style={{ marginTop: 7 }}>
            {translateCurrent("season.automation.policySummary", { profile: systemControlProfileLabel(control.profile), automated: control.systems.filter((system) => system.mode === "automated").length, manual: control.systems.filter((system) => system.mode === "manual").length })}
          </div>
          {control.recovery && <details data-testid="relaxed-recovery-audit" style={{ marginTop: 8 }}>
            <summary>{translateCurrent("season.recovery.summary", { actions: control.recovery.actions, outstanding: formatCurrency(control.recovery.outstandingAdvance) })}</summary>
            {[...props.world.systemControl!.recovery!.receipts].reverse().slice(0, 8).map((receipt) => <div key={receipt.id} data-testid={`recovery-receipt-${receipt.id}`} style={{ borderTop: "1px solid #d6c99f", marginTop: 5, paddingTop: 5, fontSize: 12 }}>
              {translateCurrent("season.recovery.receipt", {
                period: receipt.day == null ? `W${receipt.week}` : `W${receipt.week} D${receipt.day + 1}`,
                relief: formatCurrency(receipt.relief),
                repayment: formatCurrency(receipt.repayment),
                outstanding: formatCurrency(receipt.outstandingAdvance),
                pressure: receipt.economicPressure,
              })}
              <div>{receipt.reasons.join(" · ")}</div>
            </div>)}
          </details>}
          <div style={{ marginTop: 7 }}>{state.automation.decisions.map((decision) => <div key={decision}>• {systemControlDecisionLabel(decision)}</div>)}</div>
          <details style={{ marginTop: 8 }} open={control.profile === "simulation"}>
            <summary>{translateCurrent("season.automation.overrides")}</summary>
            {control.systems.filter((system) => system.visibility !== "hidden").map((system) => <div key={system.id} data-testid={`system-policy-${system.id}`} style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 5 }}>
              <span>{systemControlStatusLabel(system)}</span>
              <button type="button" disabled={!system.override && system.mode === "manual"} style={{ ...button, padding: "3px 6px", ...(!system.override && system.mode === "manual" ? { cursor: "default", opacity: .65 } : {}) }} onClick={() => run(system.override ? { type: "RETURN_SYSTEM_TO_PROFILE", system: system.id } : { type: "TAKE_SYSTEM_CONTROL", system: system.id })}>
                {translateCurrent(system.override ? "season.automation.return" : system.mode === "manual" ? "season.automation.profileDefault" : "season.automation.takeControl")}
              </button>
            </div>)}
            {control.systems.some((system) => system.visibility === "hidden") && <small>{translateCurrent("season.automation.hidden", { count: control.systems.filter((system) => system.visibility === "hidden").length })}</small>}
          </details>
          {control.systems.some((system) => system.visibility === "hidden") && <details data-testid="classic-back-office-systems" style={{ marginTop: 8 }}>
            <summary>{translateCurrent("season.automation.backOffice")}</summary>
            <small>{translateCurrent("season.automation.backOfficeHelp")}</small>
            {control.systems.filter((system) => system.visibility === "hidden").map((system) => <div key={system.id} data-testid={`back-office-policy-${system.id}`} style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 5 }}>
              <span>{systemControlStatusLabel(system)}</span>
              <button type="button" style={{ ...button, padding: "3px 6px" }} onClick={() => run({ type: "TAKE_SYSTEM_CONTROL", system: system.id })}>
                {translateCurrent("season.automation.takeControl")}
              </button>
            </div>)}
          </details>}
          {control.canGraduateTo && <button data-testid="graduate-experience-profile" type="button" style={{ ...button, marginTop: 8 }} onClick={() => run({ type: "GRADUATE_EXPERIENCE_PROFILE", target: control.canGraduateTo! })}>
            {translateCurrent("season.automation.graduate", { profile: systemControlProfileLabel(control.canGraduateTo) })}
          </button>}
        </section>
      </div>}

      {tab === "legacy" && <div style={{ display: "grid", gap: 10 }}>
        {state.yearbooks.length === 0 && <section
          style={card}
          data-testid="yearbook-empty-state"
          {...contextAttributes("empty-state")}
        >{translateCurrent("season.legacy.empty")}</section>}
        {[...state.yearbooks].reverse().map((book) => <section key={book.id} data-testid={`yearbook-${book.year}`} style={card}>
          <h3 style={{ margin: 0 }}>{translateCurrent("season.yearbook.title", { year: book.year })}</h3>
          <div>{CHARTER_DEFINITIONS[book.charter].name} · {formatCurrency(book.cash)} · {Math.round(book.reputation)} {translateCurrent("season.yearbook.reputation")}</div>
          <ol>{book.rankings.map((ranking) => <li key={ranking.clubId}><strong>{ranking.clubName}</strong> · {ranking.score}</li>)}</ol>
          <ul>{book.awards.map((annualAward) => <li key={annualAward.id}><strong>{annualAward.title}</strong> — {annualAward.recipient}<br /><small>{annualAward.fact}</small></li>)}</ul>
          {!book.dismissed && <button data-testid="acknowledge-yearbook" onClick={() => run({ type: "ACKNOWLEDGE_YEARBOOK", yearbookId: book.id })} style={button}>{translateCurrent("season.yearbook.acknowledge")}</button>}
        </section>)}
        <section style={card}>
          <h3 style={{ margin: "0 0 7px" }}>{translateCurrent("season.timeline.title")}</h3>
          {state.timeline.length === 0
            ? <div
              data-testid="timeline-empty-state"
              {...contextAttributes("empty-state")}
            >{translateCurrent("season.timeline.empty")}</div>
            : <ol>{[...state.timeline].reverse().slice(0, 30).map((entry) => <li key={entry.id}><strong>{entry.title}</strong><br /><small>{entry.detail}</small></li>)}</ol>}
        </section>
      </div>}
    </aside>
  );
}

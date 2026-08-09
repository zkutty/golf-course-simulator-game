import { useEffect, useState } from "react";
import type { CourseOperationsPatch, LiveStatus } from "../hooks/useLiveSimulation";
import { unlockedStaffRoles } from "../game/progression/progression";
import { translateCurrent } from "../i18n/core";
import { formatCurrency } from "../i18n/format";
import type { Course, CourseOperations, PacePreset, StaffMember } from "../game/models/types";
import type { SystemControlVisibility } from "../game/experience/systemControl";
import { formatStaffShiftMinute, liveOverviewTabs, staffShiftInputMinute, staffShiftInputValue, type LiveOverviewTab } from "./liveOverviewPresentation";
import { MOBILITY_BUSINESS, mobilityRentalPreview } from "../game/m51/rentalBusiness";
import { normalizeM51CourseMobilityState } from "../game/m51/mobility";
import type { MobilityMode } from "../game/m51/types";

const TAB_LABELS = { golfers: "live.tab.golfers", leaderboard: "live.tab.leaderboard", staff: "live.tab.staff", pace: "live.tab.pace", mobility: "live.tab.mobility" } as const;

function score(value: number) { return value === 0 ? "E" : value > 0 ? `+${value}` : `${value}`; }

function StaffShiftEditor(props: { member: StaffMember; onSchedule?: (staffId: string, shiftStart: number, shiftEnd: number) => void }) {
  const [start, setStart] = useState(() => staffShiftInputValue(props.member.shiftStart));
  const [end, setEnd] = useState(() => staffShiftInputValue(props.member.shiftEnd));
  const startMinute = staffShiftInputMinute(start);
  const endMinute = staffShiftInputMinute(end);
  const valid = startMinute != null && endMinute != null && endMinute - startMinute >= 60;
  const changed = valid && (startMinute !== props.member.shiftStart || endMinute !== props.member.shiftEnd);
  return <div data-testid={`staff-shift-controls-${props.member.id}`} style={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 5, alignItems: "end" }}>
    <label style={{ display: "grid", gap: 2, fontSize: 10 }}>{translateCurrent("live.staffShiftStart", { name: props.member.name })}<input type="time" min="06:00" max="20:00" step={900} value={start} onChange={(event) => setStart(event.target.value)} /></label>
    <label style={{ display: "grid", gap: 2, fontSize: 10 }}>{translateCurrent("live.staffShiftEnd", { name: props.member.name })}<input type="time" min="06:00" max="20:00" step={900} value={end} onChange={(event) => setEnd(event.target.value)} /></label>
    <button disabled={!changed} onClick={() => { if (valid) props.onSchedule?.(props.member.id, startMinute!, endMinute!); }}>{translateCurrent("live.staffShiftApply")}</button>
    <small style={{ gridColumn: "1 / -1", opacity: .72 }}>{translateCurrent("live.staffShiftForecast")}</small>
  </div>;
}

type PaidMobilityMode = Exclude<MobilityMode, "walk">;

function MobilityProductEditor(props: {
  course: Course;
  cash: number;
  buildingId: string;
  mode: PaidMobilityMode;
  reservedFleetUnitIds?: readonly string[];
  onConfigure?: (buildingId: string, mode: PaidMobilityMode, policy: { enabled: boolean; price: number }) => void;
  onPurchase?: (buildingId: string, mode: PaidMobilityMode, quantity: number) => void;
  onSalvage?: (buildingId: string, mode: PaidMobilityMode, quantity: number) => void;
}) {
  const preview = mobilityRentalPreview(props.course, props.buildingId, props.mode, props.reservedFleetUnitIds);
  const [price, setPrice] = useState(() => preview?.price ?? 0);
  const [enabled, setEnabled] = useState(() => preview?.enabled ?? false);
  if (!preview) return null;
  const normalizedPrice = Math.max(0, Math.min(MOBILITY_BUSINESS.maxPrice, Math.round(price)));
  const policyChanged = normalizedPrice !== preview.price || enabled !== preview.enabled;
  const purchaseShortfall = Math.max(0, preview.capitalCost - props.cash);
  const canPurchase = preview.availableCapacity > 0 && purchaseShortfall === 0;
  const modeLabel = props.mode.replace("_", " ");
  return <article data-testid={`mobility-product-${props.buildingId}-${props.mode}`} style={{ borderTop: "1px solid rgba(255,255,255,.14)", paddingTop: 7, display: "grid", gap: 5 }}>
    <strong style={{ textTransform: "capitalize" }}>{modeLabel}</strong>
    <div data-evidence-kind="current" style={{ fontSize: 11 }}>{translateCurrent("live.mobility.currentProduct", { enabled: preview.enabled ? translateCurrent("common.on") : translateCurrent("common.off"), price: formatCurrency(preview.price), owned: preview.owned, capacity: preview.capacity })}</div>
    <div data-evidence-kind="current" style={{ fontSize: 11 }}>{translateCurrent("live.mobility.reservations", { reserved: preview.reserved, salvageable: preview.salvageable })}</div>
    <div data-evidence-kind="forecast" style={{ fontSize: 11, opacity: .82 }}>{translateCurrent("live.mobility.productForecast", { demand: preview.estimatedDemand, capital: formatCurrency(preview.capitalCost), operating: formatCurrency(preview.perUseCost), breakEven: preview.breakEvenUses ?? "—", shortfall: formatCurrency(purchaseShortfall) })}</div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 5, alignItems: "end" }}>
      <label style={{ display: "grid", gap: 2, fontSize: 10 }}>{translateCurrent("live.mobility.price", { mode: modeLabel })}<input type="number" min={0} max={MOBILITY_BUSINESS.maxPrice} value={price} onChange={(event) => setPrice(Number(event.target.value))} /></label>
      <label style={{ fontSize: 10 }}><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> {translateCurrent("live.mobility.offer")}</label>
      <button disabled={!policyChanged} onClick={() => props.onConfigure?.(props.buildingId, props.mode, { enabled, price: normalizedPrice })}>{translateCurrent("live.mobility.applyPolicy")}</button>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
      <button disabled={!canPurchase} onClick={() => {
        const confirmed = window.confirm(translateCurrent("live.mobility.confirmPurchase", { mode: modeLabel, capital: formatCurrency(preview.capitalCost), capacity: preview.capacity, demand: preview.estimatedDemand }));
        if (confirmed) props.onPurchase?.(props.buildingId, props.mode, 1);
      }}>{translateCurrent("live.mobility.purchase", { amount: formatCurrency(preview.capitalCost) })}</button>
      <button disabled={preview.salvageable < 1} onClick={() => {
        const recovery = Math.round(preview.capitalCost * MOBILITY_BUSINESS.fleetSalvageRate);
        const confirmed = window.confirm(translateCurrent("live.mobility.confirmSalvage", { mode: modeLabel, recovery: formatCurrency(recovery) }));
        if (confirmed) props.onSalvage?.(props.buildingId, props.mode, 1);
      }}>{translateCurrent("live.mobility.salvage")}</button>
    </div>
  </article>;
}

export function LiveOverview(props: { course?: Course; cash?: number; reservedMobilityFleetUnitIds?: readonly string[]; operationsFocus?: { system: "staffing" | "pace" | "mobility"; nonce: number }; status: LiveStatus; reputation: number; staffLevel: number; staffRoster?: StaffMember[]; courses?: Array<{ id: string; name: string }>; paceVisibility: SystemControlVisibility; mobilityVisibility: SystemControlVisibility; staffingVisibility: SystemControlVisibility; onOperationsFocusHandled?: (nonce: number) => void; onAssignStaff?: (staffId: string, courseId: string) => void; onScheduleStaff?: (staffId: string, shiftStart: number, shiftEnd: number) => void; onConfigureMobility?: (buildingId: string, mode: PaidMobilityMode, policy: { enabled: boolean; price: number }) => void; onPurchaseMobility?: (buildingId: string, mode: PaidMobilityMode, quantity: number) => void; onSalvageMobility?: (buildingId: string, mode: PaidMobilityMode, quantity: number) => void; onSelectGolfer: (id: number) => void; onFocusHole?: (holeId: string) => void; onSetPacePreset?: (preset: PacePreset) => void; onUpdatePaceOperations?: (patch: CourseOperationsPatch) => void; onClose: () => void }) {
  const operationsFocus = props.operationsFocus;
  const onOperationsFocusHandled = props.onOperationsFocusHandled;
  const [tab, setTab] = useState<LiveOverviewTab>(() => operationsFocus?.system === "staffing" ? "staff" : operationsFocus?.system ?? "golfers");
  const [reportDays, setReportDays] = useState<7 | 28>(7);
  const [reportCourseId, setReportCourseId] = useState(props.status.pace.courseId);
  const golfers = [...props.status.golfers];
  const leaderboard = props.status.tournament
    ? props.status.tournament.standings.map((row) => ({ id: row.entrantId, name: row.name, scoreToPar: row.scoreToPar, thru: row.holesCompleted }))
    : [...golfers].sort((a, b) => a.scoreToPar - b.scoreToPar || b.currentHole - a.currentHole).map((row) => ({ id: String(row.id), name: row.name, scoreToPar: row.scoreToPar, thru: Math.max(0, row.currentHole) }));
  const roles = unlockedStaffRoles(props.reputation);
  const availableTabs = liveOverviewTabs({ pace: props.paceVisibility, mobility: props.mobilityVisibility });
  const activeTab = availableTabs.includes(tab) ? tab : "golfers";
  useEffect(() => {
    const focus = operationsFocus;
    if (!focus) return;
    const frame = window.requestAnimationFrame(() => {
      const selector = focus.system === "pace" ? "[data-testid=pace-operations]" : `[data-operation-system="${focus.system}"]`;
      const target = document.querySelector<HTMLElement>(selector);
      target?.scrollIntoView({ block: "center", behavior: document.documentElement.dataset.reducedMotion === "true" ? "auto" : "smooth" });
      (target?.querySelector<HTMLElement>("button,input,select") ?? target)?.focus({ preventScroll: true });
      if (target) onOperationsFocusHandled?.(focus.nonce);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [onOperationsFocusHandled, operationsFocus]);
  return <aside className="cc-live-overview" data-testid="live-overview" style={{ position: "absolute", right: 14, top: 14, zIndex: 125, width: "min(360px,calc(100% - 28px))", maxHeight: "calc(100% - 110px)", overflow: "auto", padding: 13, borderRadius: 12, background: "rgba(24,33,26,.94)", color: "#f6f4e8", boxShadow: "0 10px 30px rgba(0,0,0,.4)" }}>
    <header style={{ display: "flex", gap: 8, alignItems: "center" }}><div style={{ flex: 1 }}><strong style={{ fontSize: 16 }}>{translateCurrent("live.overview")}</strong><div style={{ fontSize: 11, opacity: .7 }}>{translateCurrent("live.arrivals", { count: props.status.arrivalsRemaining })}</div></div><button aria-label={translateCurrent("live.closeOverview")} onClick={props.onClose}>✕</button></header>
    <div role="tablist" aria-label={translateCurrent("live.overviewTabs")} style={{ display: "grid", gridTemplateColumns: `repeat(${availableTabs.length},1fr)`, gap: 4, margin: "11px 0" }}>
      {availableTabs.map((name) => <button role="tab" aria-selected={activeTab === name} key={name} onClick={() => setTab(name)} style={{ padding: 7, borderRadius: 7, border: activeTab === name ? "1px solid #9bd18a" : "1px solid rgba(255,255,255,.18)", background: activeTab === name ? "rgba(112,171,91,.28)" : "rgba(255,255,255,.06)", color: "inherit" }}>{translateCurrent(TAB_LABELS[name])}</button>)}
    </div>
    {activeTab === "golfers" && <div style={{ display: "grid", gap: 5 }}>{golfers.length === 0 ? <small>{translateCurrent("live.noGolfers")}</small> : golfers.slice(0, 24).map((golfer) => <button key={golfer.id} onClick={() => props.onSelectGolfer(golfer.id)} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, textAlign: "left", alignItems: "center", padding: 8, borderRadius: 8, border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.06)", color: "inherit" }}><span><b>{golfer.name}</b><br /><small style={{ opacity: .65 }}>{golfer.currentHole >= 0 ? translateCurrent("live.hole", { hole: golfer.currentHole + 1 }) : translateCurrent("live.clubhouse")}</small></span><span>{score(golfer.scoreToPar)}</span><span title={translateCurrent("live.mood")}>{golfer.mood >= .65 ? "☺" : golfer.mood < .35 ? "☹" : "•"}</span></button>)}</div>}
    {activeTab === "leaderboard" && <ol style={{ margin: 0, paddingLeft: 24 }}>{leaderboard.slice(0, 12).map((row) => <li key={row.id} style={{ padding: "5px 0" }}><span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b>{row.name}</b><span>{score(row.scoreToPar)} · {row.thru} {translateCurrent("golfer.thru")}</span></span></li>)}</ol>}
    {activeTab === "staff" && <div data-operation-system="staffing"><div style={{ padding: 9, borderRadius: 8, background: "rgba(255,255,255,.07)" }}><strong>{translateCurrent("live.staffCoverage", { active: props.staffRoster?.length ?? props.staffLevel, available: roles.length })}</strong><div style={{ fontSize: 12, opacity: .72 }}>{translateCurrent("live.staffHint")}</div>{props.staffingVisibility === "full" && <div data-testid="staff-shift-readonly" style={{ marginTop: 5, fontSize: 11, opacity: .82 }}>{translateCurrent("live.staffShiftReadOnly")}</div>}</div>{props.staffRoster?.length ? <div style={{ display: "grid", gap: 6, marginTop: 8 }}>{props.staffRoster.map((member) => <article key={member.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, padding: 7, borderRadius: 7, background: "rgba(255,255,255,.06)" }}><span><b>{member.name}</b><br/><small style={{ textTransform: "capitalize", opacity: .7 }}>{member.role.replaceAll("_", " ")} · {translateCurrent("live.weeklyWage", { wage: member.weeklyWage })}</small>{props.staffingVisibility === "full" && <small data-testid={`staff-shift-${member.id}`} style={{ display: "block", marginTop: 3, opacity: .88 }}>{translateCurrent("live.staffShift", { start: formatStaffShiftMinute(member.shiftStart), end: formatStaffShiftMinute(member.shiftEnd) })}</small>}</span><select aria-label={translateCurrent("live.assignStaff", { name: member.name })} value={member.courseId ?? ""} onChange={(event) => props.onAssignStaff?.(member.id, event.target.value)} style={{ maxWidth: 120 }}>{props.courses?.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select>{props.staffingVisibility === "full" && <StaffShiftEditor key={`${member.id}:${member.shiftStart}:${member.shiftEnd}`} member={member} onSchedule={props.onScheduleStaff} />}</article>)}</div> : <ul style={{ marginBottom: 0 }}>{roles.map((role, index) => <li key={role} style={{ opacity: index < props.staffLevel ? 1 : .55, padding: "3px 0" }}>{index < props.staffLevel ? "●" : "○"} {role} — {index < props.staffLevel ? translateCurrent("live.onDuty") : translateCurrent("live.available")}</li>)}</ul>}</div>}
    {activeTab === "pace" && <div data-testid={props.paceVisibility === "full" ? "pace-operations" : "pace-summary-surface"} style={{ display: "grid", gap: 9 }}>
      <section data-testid="pace-summary" style={{ padding: 9, borderRadius: 8, background: "rgba(255,255,255,.07)", display: "grid", gridTemplateColumns: "1fr auto", gap: 5, fontSize: 12 }}>
        <span>{translateCurrent("live.pace.currentPolicy")}</span><b style={{ textTransform: "capitalize" }}>{props.status.pace.preset}</b>
        <span>{translateCurrent("live.pace.groupsOnCourse")}</span><b>{props.status.pace.groupsOnCourse}</b>
        <span>{translateCurrent("live.pace.averageWait")}</span><b>{translateCurrent("live.pace.minutes", { minutes: props.status.pace.averageWaitMinutes.toFixed(1) })}</b>
      </section>
      {props.paceVisibility === "full" && <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 5 }}>{(["relaxed", "balanced", "brisk"] as PacePreset[]).map((preset) => <button key={preset} aria-pressed={props.status.pace.preset === preset} onClick={() => props.onSetPacePreset?.(preset)} style={{ textTransform: "capitalize", padding: 8, borderRadius: 7, color: "inherit", border: props.status.pace.preset === preset ? "1px solid #9bd18a" : "1px solid rgba(255,255,255,.18)", background: props.status.pace.preset === preset ? "rgba(112,171,91,.28)" : "rgba(255,255,255,.06)" }}>{preset}</button>)}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}><label style={{ display: "grid", gap: 3, fontSize: 11 }}>{translateCurrent("live.pace.teeInterval")}<input aria-label={translateCurrent("live.pace.teeIntervalAria")} type="number" min={7} max={15} value={props.status.pace.teeIntervalMinutes} onChange={(event) => props.onUpdatePaceOperations?.({ teeIntervalMinutes: Number(event.target.value) })}/></label><label style={{ display: "grid", gap: 3, fontSize: 11 }}>{translateCurrent("live.pace.beverageService")}<select aria-label={translateCurrent("live.pace.beverageService")} value={props.status.pace.beverageMenu} onChange={(event) => props.onUpdatePaceOperations?.({ beverage: { menu: event.target.value as CourseOperations["beverage"]["menu"] } })}><option value="off">{translateCurrent("common.off")}</option><option value="refreshments">{translateCurrent("live.pace.refreshments")}</option><option value="beer_wine">{translateCurrent("live.pace.beerWine")}</option></select></label></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
        <label style={{ display: "grid", gap: 3, fontSize: 11 }}>{translateCurrent("live.pace.lastTee")}<input aria-label={translateCurrent("live.pace.lastTee")} type="number" min={240} max={720} step={15} value={props.status.pace.lastTeeMinute} onChange={(event) => props.onUpdatePaceOperations?.({ lastTeeMinute: Number(event.target.value) })}/></label>
        <label style={{ display: "grid", gap: 3, fontSize: 11 }}>{translateCurrent("live.pace.daylight")}<select aria-label={translateCurrent("live.pace.daylight")} value={props.status.pace.daylightPolicy} onChange={(event) => props.onUpdatePaceOperations?.({ daylightPolicy: event.target.value as CourseOperations["daylightPolicy"] })}><option value="finish_started">{translateCurrent("live.pace.finishStarted")}</option><option value="strict_sunset">{translateCurrent("live.pace.strictSunset")}</option></select></label>
        <label style={{ display: "grid", gap: 3, fontSize: 11, gridColumn: "1 / -1" }}>{translateCurrent("live.pace.compensation")}<select aria-label={translateCurrent("live.pace.compensation")} value={props.status.pace.compensationPolicy} onChange={(event) => props.onUpdatePaceOperations?.({ compensationPolicy: event.target.value as CourseOperations["compensationPolicy"] })}><option value="refund">{translateCurrent("live.pace.refund")}</option><option value="credit">{translateCurrent("live.pace.credit")}</option><option value="goodwill">{translateCurrent("live.pace.goodwill")}</option></select></label>
      </div>
      <div style={{ padding: 9, borderRadius: 8, background: "rgba(255,255,255,.07)", display: "grid", gridTemplateColumns: "1fr auto", gap: 5, fontSize: 12 }}>
        <span>{translateCurrent("live.pace.teeInterval")}</span><b>{translateCurrent("live.pace.minutes", { minutes: props.status.pace.teeIntervalMinutes })}</b><span>{translateCurrent("live.pace.maximumGroup")}</span><b>{props.status.pace.maxGroupSize}</b><span>{translateCurrent("live.pace.groupsBlocked")}</span><b>{props.status.pace.groupsOnCourse} / {props.status.pace.blockedGroups}</b><span>{translateCurrent("live.pace.averageWait")}</span><b>{translateCurrent("live.pace.minutes", { minutes: props.status.pace.averageWaitMinutes.toFixed(1) })}</b><span>{translateCurrent("live.pace.marshalCoverage")}</span><b>{props.status.pace.marshalCoverage}</b><span>{translateCurrent("live.pace.interventionsPickups")}</span><b>{props.status.pace.interventions} / {props.status.pace.pickups}</b><span>{translateCurrent("live.pace.beverageCoverage")}</span><b>{props.status.pace.beverageCoverage}</b><span>{translateCurrent("live.pace.beverageRevenue")}</span><b>${props.status.pace.beverageRevenue}</b><span>{translateCurrent("live.pace.alcoholIncidents")}</span><b>{props.status.pace.alcoholicDrinks} / {props.status.pace.incidents}</b>
      </div>
      <section data-testid="pace-identity" style={{ padding: 9, borderRadius: 8, border: "1px solid rgba(255,255,255,.16)" }}>
        <strong>{translateCurrent("live.pace.identity")}: {props.status.pace.identity.label}</strong>
        <div style={{ fontSize: 11, opacity: .75 }}>{translateCurrent("live.pace.identityDetail", { days: props.status.pace.identity.samples, skilled: Math.round(props.status.pace.identity.cohorts.skilled_impatient * 100), novice: Math.round(props.status.pace.identity.cohorts.novice_social * 100) })}</div>
      </section>
      <section data-testid="pace-bottlenecks" aria-label={translateCurrent("live.pace.bottlenecks")} style={{ display: "grid", gap: 6 }}>
        <strong>{translateCurrent("live.pace.bottlenecks")}</strong>
        {props.status.pace.bottlenecks.length === 0
          ? <small style={{ opacity: .72 }}>{translateCurrent("live.pace.noBottlenecks")}</small>
          : props.status.pace.bottlenecks.map((finding) => <button key={finding.holeId} onClick={() => props.onFocusHole?.(finding.holeId)} style={{ color: "inherit", textAlign: "left", padding: 8, borderRadius: 7, border: "1px solid rgba(255,255,255,.16)", background: "rgba(255,255,255,.05)" }}>
            <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b>{translateCurrent("live.hole", { hole: finding.holeIndex + 1 })}</b><span>{finding.severity.toUpperCase()} · {translateCurrent("live.pace.minutes", { minutes: finding.intensity.toFixed(1) })}</span></span>
            <span style={{ display: "block", height: 5, borderRadius: 4, background: "rgba(255,255,255,.12)", margin: "6px 0" }}><span style={{ display: "block", height: "100%", width: `${Math.min(100, finding.intensity * 8)}%`, borderRadius: 4, background: "#e7b95d" }}/></span>
            <span style={{ display: "block", fontSize: 11 }}>{finding.reason}</span>
            <span style={{ display: "block", fontSize: 11, marginTop: 4 }}><b>{translateCurrent("live.pace.action")}:</b> {finding.recommendation}</span>
            <span style={{ display: "block", fontSize: 10, opacity: .72 }}>{finding.tradeoff}</span>
          </button>)}
      </section>
      <section data-testid="pace-history" style={{ display: "grid", gap: 6, padding: 9, borderRadius: 8, background: "rgba(255,255,255,.07)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6 }}>
          <label style={{ display: "grid", gap: 2, fontSize: 11 }}>{translateCurrent("live.pace.reportCourse")}<select value={reportCourseId} onChange={(event) => setReportCourseId(event.target.value)}>{props.status.pace.reports28.map((report) => <option key={report.courseId} value={report.courseId}>{report.courseName}</option>)}</select></label>
          <label style={{ display: "grid", gap: 2, fontSize: 11 }}>{translateCurrent("live.pace.period")}<select value={reportDays} onChange={(event) => setReportDays(Number(event.target.value) as 7 | 28)}><option value={7}>{translateCurrent("live.pace.sevenDays")}</option><option value={28}>{translateCurrent("live.pace.twentyEightDays")}</option></select></label>
        </div>
        {(() => {
          const reports = reportDays === 7 ? props.status.pace.reports7 : props.status.pace.reports28;
          const report = reports.find((candidate) => candidate.courseId === reportCourseId) ?? reports[0];
          if (!report) return <small>{translateCurrent("live.pace.noHistory")}</small>;
          return <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 4, fontSize: 11 }}>
            {report.sparse && <small style={{ gridColumn: "1 / -1", opacity: .75 }}>{translateCurrent("live.pace.sparse")}</small>}
            <span>{translateCurrent("live.pace.roundsComplete")}</span><b>{report.roundsCompleted} / {report.roundsIncomplete}</b>
            <span>{translateCurrent("live.pace.durationP90")}</span><b>{translateCurrent("live.pace.durationPair", { average: report.averageDurationMinutes.toFixed(0), p90: report.p90DurationMinutes.toFixed(0) })}</b>
            <span>{translateCurrent("live.pace.waitPickups")}</span><b>{translateCurrent("live.pace.waitPickupValue", { wait: report.averageWaitMinutes.toFixed(1), pickups: report.pickups })}</b>
            <span>{translateCurrent("live.pace.teeHourRevenue")}</span><b>${report.revenuePerTeeHour.toFixed(0)} / ${report.netRevenuePerTeeHour.toFixed(0)}</b>
            <span>{translateCurrent("live.pace.overtimeComp")}</span><b>${report.overtimeCost.toFixed(0)} / ${report.compensationCost.toFixed(0)}</b>
            <span>{translateCurrent("live.pace.beverageNet")}</span><b>${report.beverageRevenue.toFixed(0)} / ${report.netRevenue.toFixed(0)}</b>
          </div>;
        })()}
      </section>
      <small style={{ opacity: .72 }}>{translateCurrent("live.pace.policyHint")}</small>
      </>}
    </div>}
    {activeTab === "mobility" && props.mobilityVisibility === "full" && <section data-testid="mobility-operations" data-operation-system="mobility" style={{ display: "grid", gap: 6, padding: 9, borderRadius: 8, background: "rgba(112,171,91,.12)", border: "1px solid rgba(155,209,138,.35)" }}>
        <strong>{translateCurrent("live.mobility.title")}</strong>
        <label style={{ display: "grid", gap: 2, fontSize: 11 }}>{translateCurrent("live.pace.period")}<select value={reportDays} onChange={(event) => setReportDays(Number(event.target.value) as 7 | 28)}><option value={7}>{translateCurrent("live.pace.sevenDays")}</option><option value={28}>{translateCurrent("live.pace.twentyEightDays")}</option></select></label>
        {(() => {
          const report = reportDays === 7 ? props.status.mobility.reports7 : props.status.mobility.reports28;
          const metricRows = (value: typeof report) => <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 4, fontSize: 11 }}>
            <span>{translateCurrent("live.mobility.modeMix")}</span><b>{value.modeMix.walk} / {value.modeMix.pushcart} / {value.modeMix.riding_cart}</b>
            <span>{translateCurrent("live.mobility.fleet")}</span><b>{value.fleet.owned} / {value.fleet.available} / {value.fleet.inUse}</b>
            <span>{translateCurrent("live.mobility.peakUtilization")}</span><b>{Math.round(value.fleet.peakUtilization * 100)}%</b>
            <span>{translateCurrent("live.mobility.rentalsStockouts")}</span><b>{value.completedRentals} / {value.stockouts}</b>
            <span>{translateCurrent("live.mobility.conversion", { evidence: value.conversion.evidence })}</span><b>{Math.round(value.conversion.value * 100)}%</b>
            <span>{translateCurrent("live.mobility.minutesSaved")}</span><b>{translateCurrent("live.mobility.minutes", { minutes: value.observedMinutesSaved.toFixed(0) })}</b>
            <span>{translateCurrent("live.mobility.productEconomics")}</span><b>${value.productRevenue.toFixed(0)} / ${value.operatingCost.toFixed(0)}</b>
            <span>{translateCurrent("live.mobility.teeHourContribution")}</span><b>${value.netContribution.toFixed(0)} / ${value.netRevenuePerOccupiedTeeHour.toFixed(0)}</b>
          </div>;
          return <>
            <div data-testid="mobility-current-day" data-evidence-kind="current" style={{ paddingBottom: 7, borderBottom: "1px solid rgba(255,255,255,.14)" }}><b style={{ fontSize: 12 }}>{translateCurrent("live.mobility.currentEvidence", { label: translateCurrent("season.operations.evidence.current"), evidence: props.status.mobility.current.evidence })}</b><div style={{ marginTop: 5 }}>{metricRows(props.status.mobility.current)}</div></div>
            <div data-testid="mobility-history-report" data-evidence-kind="settled"><b style={{ fontSize: 12 }}>{translateCurrent("live.mobility.settledEvidence", { label: translateCurrent("season.operations.evidence.settled"), report: report.label })}</b><div style={{ marginTop: 5 }}>{metricRows(report)}</div></div>
            <small data-testid="mobility-demand-state" style={{ opacity: .8 }}>{translateCurrent("live.mobility.demand", { stockout: report.demand.stockout, lowDemand: report.demand.lowDemand, unaffordable: report.demand.unaffordable, evidence: report.demand.evidence })}</small>
            <small data-testid="mobility-recommendation" style={{ opacity: .9 }}>{translateCurrent("live.mobility.recommendation", { state: report.recommendation.state, detail: report.recommendation.detail })}</small>
          </>;
        })()}
        {props.course && (() => {
          const rentals = Object.values(normalizeM51CourseMobilityState(props.course.m51, props.course).cartRentals);
          if (rentals.length === 0) return <small data-testid="mobility-no-rental" data-evidence-kind="forecast">{translateCurrent("live.mobility.noRental")}</small>;
          return <div data-testid="mobility-fleet-controls" style={{ display: "grid", gap: 8 }}>
            {rentals.map((rental) => <section key={rental.buildingId} style={{ border: "1px solid rgba(255,255,255,.16)", borderRadius: 7, padding: 7 }}>
              <strong>{translateCurrent("live.mobility.rental", { id: rental.buildingId, tier: rental.tier })}</strong>
              {(["pushcart", "riding_cart"] as const).map((mode) => <MobilityProductEditor key={`${mode}:${rental.products[mode].price}:${rental.products[mode].enabled}`} course={props.course!} cash={props.cash ?? 0} buildingId={rental.buildingId} mode={mode} reservedFleetUnitIds={props.reservedMobilityFleetUnitIds} onConfigure={props.onConfigureMobility} onPurchase={props.onPurchaseMobility} onSalvage={props.onSalvageMobility} />)}
            </section>)}
          </div>;
        })()}
      </section>}
  </aside>;
}

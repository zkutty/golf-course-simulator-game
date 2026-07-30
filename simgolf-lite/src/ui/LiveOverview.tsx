import { useState } from "react";
import type { CourseOperationsPatch, LiveStatus } from "../hooks/useLiveSimulation";
import { unlockedStaffRoles } from "../game/progression/progression";
import { translateCurrent } from "../i18n/core";
import type { CourseOperations, PacePreset, StaffMember } from "../game/models/types";

type Tab = "golfers" | "leaderboard" | "staff" | "pace";
const TAB_LABELS = { golfers: "live.tab.golfers", leaderboard: "live.tab.leaderboard", staff: "live.tab.staff", pace: "live.tab.pace" } as const;

function score(value: number) { return value === 0 ? "E" : value > 0 ? `+${value}` : `${value}`; }

export function LiveOverview(props: { status: LiveStatus; reputation: number; staffLevel: number; staffRoster?: StaffMember[]; courses?: Array<{ id: string; name: string }>; onAssignStaff?: (staffId: string, courseId: string) => void; onSelectGolfer: (id: number) => void; onFocusHole?: (holeId: string) => void; onSetPacePreset?: (preset: PacePreset) => void; onUpdatePaceOperations?: (patch: CourseOperationsPatch) => void; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("golfers");
  const [reportDays, setReportDays] = useState<7 | 28>(7);
  const [reportCourseId, setReportCourseId] = useState(props.status.pace.courseId);
  const golfers = [...props.status.golfers];
  const leaderboard = props.status.tournament
    ? props.status.tournament.standings.map((row) => ({ id: row.entrantId, name: row.name, scoreToPar: row.scoreToPar, thru: row.holesCompleted }))
    : [...golfers].sort((a, b) => a.scoreToPar - b.scoreToPar || b.currentHole - a.currentHole).map((row) => ({ id: String(row.id), name: row.name, scoreToPar: row.scoreToPar, thru: Math.max(0, row.currentHole) }));
  const roles = unlockedStaffRoles(props.reputation);
  return <aside className="cc-live-overview" data-testid="live-overview" style={{ position: "absolute", right: 14, top: 14, zIndex: 125, width: "min(360px,calc(100% - 28px))", maxHeight: "calc(100% - 110px)", overflow: "auto", padding: 13, borderRadius: 12, background: "rgba(24,33,26,.94)", color: "#f6f4e8", boxShadow: "0 10px 30px rgba(0,0,0,.4)" }}>
    <header style={{ display: "flex", gap: 8, alignItems: "center" }}><div style={{ flex: 1 }}><strong style={{ fontSize: 16 }}>{translateCurrent("live.overview")}</strong><div style={{ fontSize: 11, opacity: .7 }}>{translateCurrent("live.arrivals", { count: props.status.arrivalsRemaining })}</div></div><button aria-label={translateCurrent("live.closeOverview")} onClick={props.onClose}>✕</button></header>
    <div role="tablist" aria-label={translateCurrent("live.overviewTabs")} style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 4, margin: "11px 0" }}>
      {(["golfers", "leaderboard", "staff", "pace"] as Tab[]).map((name) => <button role="tab" aria-selected={tab === name} key={name} onClick={() => setTab(name)} style={{ padding: 7, borderRadius: 7, border: tab === name ? "1px solid #9bd18a" : "1px solid rgba(255,255,255,.18)", background: tab === name ? "rgba(112,171,91,.28)" : "rgba(255,255,255,.06)", color: "inherit" }}>{translateCurrent(TAB_LABELS[name])}</button>)}
    </div>
    {tab === "golfers" && <div style={{ display: "grid", gap: 5 }}>{golfers.length === 0 ? <small>{translateCurrent("live.noGolfers")}</small> : golfers.slice(0, 24).map((golfer) => <button key={golfer.id} onClick={() => props.onSelectGolfer(golfer.id)} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, textAlign: "left", alignItems: "center", padding: 8, borderRadius: 8, border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.06)", color: "inherit" }}><span><b>{golfer.name}</b><br /><small style={{ opacity: .65 }}>{golfer.currentHole >= 0 ? translateCurrent("live.hole", { hole: golfer.currentHole + 1 }) : translateCurrent("live.clubhouse")}</small></span><span>{score(golfer.scoreToPar)}</span><span title={translateCurrent("live.mood")}>{golfer.mood >= .65 ? "☺" : golfer.mood < .35 ? "☹" : "•"}</span></button>)}</div>}
    {tab === "leaderboard" && <ol style={{ margin: 0, paddingLeft: 24 }}>{leaderboard.slice(0, 12).map((row) => <li key={row.id} style={{ padding: "5px 0" }}><span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b>{row.name}</b><span>{score(row.scoreToPar)} · {row.thru} {translateCurrent("golfer.thru")}</span></span></li>)}</ol>}
    {tab === "staff" && <div><div style={{ padding: 9, borderRadius: 8, background: "rgba(255,255,255,.07)" }}><strong>{translateCurrent("live.staffCoverage", { active: props.staffRoster?.length ?? props.staffLevel, available: roles.length })}</strong><div style={{ fontSize: 12, opacity: .72 }}>{translateCurrent("live.staffHint")}</div></div>{props.staffRoster?.length ? <div style={{ display: "grid", gap: 6, marginTop: 8 }}>{props.staffRoster.map((member) => <label key={member.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, padding: 7, borderRadius: 7, background: "rgba(255,255,255,.06)" }}><span><b>{member.name}</b><br/><small style={{ textTransform: "capitalize", opacity: .7 }}>{member.role.replaceAll("_", " ")} · {translateCurrent("live.weeklyWage", { wage: member.weeklyWage })}</small></span><select aria-label={translateCurrent("live.assignStaff", { name: member.name })} value={member.courseId ?? ""} onChange={(event) => props.onAssignStaff?.(member.id, event.target.value)} style={{ maxWidth: 120 }}>{props.courses?.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label>)}</div> : <ul style={{ marginBottom: 0 }}>{roles.map((role, index) => <li key={role} style={{ opacity: index < props.staffLevel ? 1 : .55, padding: "3px 0" }}>{index < props.staffLevel ? "●" : "○"} {role} — {index < props.staffLevel ? translateCurrent("live.onDuty") : translateCurrent("live.available")}</li>)}</ul>}</div>}
    {tab === "pace" && <div data-testid="pace-operations" style={{ display: "grid", gap: 9 }}>
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
      <section data-testid="mobility-operations" style={{ display: "grid", gap: 6, padding: 9, borderRadius: 8, background: "rgba(112,171,91,.12)", border: "1px solid rgba(155,209,138,.35)" }}>
        <strong>{translateCurrent("live.mobility.title")}</strong>
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
            <div data-testid="mobility-current-day" style={{ paddingBottom: 7, borderBottom: "1px solid rgba(255,255,255,.14)" }}><b style={{ fontSize: 12 }}>{translateCurrent("live.mobility.currentDay", { evidence: props.status.mobility.current.evidence })}</b><div style={{ marginTop: 5 }}>{metricRows(props.status.mobility.current)}</div></div>
            <div data-testid="mobility-history-report"><b style={{ fontSize: 12 }}>{report.label}</b><div style={{ marginTop: 5 }}>{metricRows(report)}</div></div>
            <small data-testid="mobility-demand-state" style={{ opacity: .8 }}>{translateCurrent("live.mobility.demand", { stockout: report.demand.stockout, lowDemand: report.demand.lowDemand, unaffordable: report.demand.unaffordable, evidence: report.demand.evidence })}</small>
            <small data-testid="mobility-recommendation" style={{ opacity: .9 }}>{translateCurrent("live.mobility.recommendation", { state: report.recommendation.state, detail: report.recommendation.detail })}</small>
          </>;
        })()}
      </section>
      <small style={{ opacity: .72 }}>{translateCurrent("live.pace.policyHint")}</small>
    </div>}
  </aside>;
}

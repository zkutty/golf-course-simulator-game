import type { Course, WeekResult, World } from "../game/models/types";
import { buildM49CourseReport } from "../game/m49/report";
import { formatCurrency } from "../i18n/format";
import { translateCurrent } from "../i18n/core";

/** Loaded only when the weekly report mounts, independently of its core metrics. No report data is cached. */
export function buildWeekCloseManagement(props: { course: Course; world: World; result: WeekResult; week: number }) {
  const management = buildM49CourseReport({
    course: props.course, world: props.world, result: props.result, generatedAtWeek: props.week,
  });
  return {
    beforeAudience: <>
            <div className="cc-week-close-management-intro">{management.observedRounds ? translateCurrent(management.observedRounds === 1 ? "weekClose.managementIntroObservedOne" : "weekClose.managementIntroObserved", { headline: management.headline, rounds: management.observedRounds }) : translateCurrent("weekClose.managementIntroPredicted", { headline: management.headline })}</div>
            <div className="cc-week-close-segments" aria-label={translateCurrent("weekClose.managementSupportedSegments")}>
              {management.demand.supportedSegments.map((segment) => <span key={segment} className="cc-week-close-segment">{segment}</span>)}
              {!management.demand.supportedSegments.length && <span className="cc-week-close-no-fit">{translateCurrent("weekClose.managementNoFit")}</span>}
            </div>
    </>,
    audience: <>
              <table>
                <thead><tr><th scope="col">{translateCurrent("weekClose.managementAudience")}</th><th scope="col">{translateCurrent("weekClose.managementAppeal")}</th><th scope="col">{translateCurrent("weekClose.managementPay")}</th><th scope="col">{translateCurrent("weekClose.managementEvidenceLabel")}</th></tr></thead>
                <tbody>{Object.values(management.demand.segments).map((segment) => <tr key={segment.segment}>
                  <th scope="row">{segment.segment}</th><td>{Math.round(segment.bookingAppeal * 100)}%</td><td>{formatCurrency(segment.willingnessToPay)}</td><td>{segment.evidenceLabel}</td>
                </tr>)}</tbody>
              </table>
    </>,
    afterAudience: <>
            <div className="cc-week-close-condition">
              {translateCurrent("weekClose.managementCondition", { condition: Math.round(management.condition.overall * 100), maintenance: management.condition.shortfall > 0 ? translateCurrent("weekClose.managementMaintenanceShort", { amount: formatCurrency(management.condition.shortfall) }) : translateCurrent("weekClose.managementMaintenanceOnPlan"), projected: Math.round(management.condition.projectedRecovery * 100) })}
            </div>
            {management.alerts.length > 0 && <div className="cc-week-close-evidence"><strong>{translateCurrent("weekClose.managementWatchNext")}</strong>{management.alerts.slice(0, 3).map((alert) => <div key={alert.id} className="cc-week-close-alert" style={{ color: alert.severity === "urgent" ? "#9a332d" : alert.severity === "warning" ? "#8a641e" : "#4c5b4c" }}>{translateCurrent("weekClose.managementAlert", { title: alert.title, action: alert.action })}</div>)}</div>}
            {management.topCauses.length > 0 && <div className="cc-week-close-evidence"><strong>{translateCurrent("weekClose.managementObservedCauses")}</strong>{management.topCauses.slice(0, 3).map((cause) => <div key={cause.cause} className="cc-week-close-cause">{translateCurrent("weekClose.managementCause", { cause: cause.cause, count: cause.observations })}</div>)}</div>}
            <div className="cc-week-close-ledger" style={{ color: management.reconciliation.ledgerBalanced ? "#27643a" : "#9a332d" }}>{translateCurrent(management.reconciliation.ledgerBalanced ? "weekClose.managementLedgerReconciled" : "weekClose.managementLedgerReview")}</div>
    </>,
  };
}

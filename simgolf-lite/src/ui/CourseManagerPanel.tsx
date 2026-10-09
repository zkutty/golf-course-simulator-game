import { useId, useRef, useState, type KeyboardEvent } from "react";
import type { Course, World } from "../game/models/types";
import {
  addEstateHole,
  assignHoleToLayout,
  courseLayouts,
  createLayout,
  publishLayout,
  selectLayout,
  updateLayout,
  validateDraftRouting,
  courseForLayout,
} from "../game/models/courseLayouts";
import { useI18n } from "../i18n/useI18n";
import { courseOperationalMetrics } from "../game/sim/courseOperations";
import { analyzeArchitecture } from "../game/architecture/architecture";
import type { MessageKey } from "../i18n/catalog";
import { IconUi } from "../assets/icons/IconUi";
import "./CourseManagerPanel.css";

export function CourseManagerPanel(props: {
  course: Course;
  world: World;
  onChange: (course: Course) => void;
  onSelectHole: (holeId: string) => void;
  onCenter: (point: { x: number; y: number }) => void;
  onOpenGolfopedia: (entry: string) => void;
  onOpenArchitectureReview: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const layouts = courseLayouts(props.course);
  const active = layouts.find((layout) => layout.id === props.course.activeCourseId) ?? layouts[0];
  const [selectedHole, setSelectedHole] = useState("");
  const [message, setMessage] = useState("");
  const instanceId = useId();
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const tabId = (id: string) => `${instanceId}-course-tab-${encodeURIComponent(id)}`;
  const panelId = (id: string) => `${instanceId}-course-panel-${encodeURIComponent(id)}`;
  const chooseLayout = (id: string) => { change(selectLayout(props.course, id)); setMessage(""); };
  const onLayoutKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    const index = layouts.findIndex(layout => layout.id === id);
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % layouts.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + layouts.length) % layouts.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = layouts.length - 1;
    else return;
    event.preventDefault();
    const selected = layouts[next];
    if (selected.id !== active.id) chooseLayout(selected.id);
    tabRefs.current.get(selected.id)?.focus();
  };
  const assigned = new Set(layouts.flatMap((layout) => layout.draftHoleIds));
  const available = props.course.holes.filter((hole) => hole.id && !assigned.has(hole.id));
  const validation = validateDraftRouting(props.course, active.id);
  const metrics = courseOperationalMetrics(props.course, props.world, active.id)[0];
  const architecture = analyzeArchitecture(courseForLayout(props.course, active.id));
  const componentCopy = (item: (typeof architecture.components)[keyof typeof architecture.components]) => {
    const raw = item.raw;
    if (item.id === "routing") return t("architecture.explanation.routing", { transfer: raw.averageTransferTiles, clubhouse: raw.firstTeeClubhouseTiles + raw.finalGreenClubhouseTiles });
    if (item.id === "naturalFit") return t("architecture.explanation.naturalFit", { retained: raw.retainedTerrainPercent, earthwork: raw.earthworkStepsPer100Tiles });
    if (item.id === "variety") return t("architecture.explanation.variety", { pars: raw.parTypes, lengths: raw.lengthBands, directions: raw.directionBuckets, shapes: raw.shapeTypes });
    if (item.id === "safety") return t("architecture.explanation.safety", { crossings: raw.crossings, parallels: raw.parallelDangerZones, repetitions: raw.repetitions });
    return t("architecture.explanation.walkability", { routed: raw.routedTransfers, transfers: raw.transferCount, total: raw.totalWalkingTiles });
  };

  const change = (course: Course) => props.onChange(course);
  const reorder = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= active.draftHoleIds.length) return;
    const ids = [...active.draftHoleIds];
    [ids[index], ids[target]] = [ids[target], ids[index]];
    change(updateLayout(props.course, active.id, { draftHoleIds: ids }));
  };

  return <aside role="dialog" aria-modal="false" aria-label={t("courses.title")} data-testid="course-manager" className="cc-course-manager">
    <header className="cc-course-manager__header">
      <h2>{t("courses.title")}</h2>
      <button className="cc-course-manager__close" aria-label={t("courses.close")} onClick={props.onClose}>
        <IconUi name="close" />
      </button>
    </header>
    <div role="tablist" aria-label={t("courses.layouts")} className="cc-course-manager__tabs">
      {layouts.map(layout => <button key={layout.id} id={tabId(layout.id)} role="tab" data-layout-id={layout.id}
        aria-selected={layout.id === active.id} aria-controls={panelId(layout.id)} tabIndex={layout.id === active.id ? 0 : -1}
        ref={element => { if (element) tabRefs.current.set(layout.id, element); else tabRefs.current.delete(layout.id); }}
        onClick={() => chooseLayout(layout.id)} onKeyDown={event => onLayoutKeyDown(event, layout.id)}>{layout.name}</button>)}
    </div>
    <div role="group" aria-label={t("courses.layoutActions")} className="cc-course-manager__actions">
      <button data-testid="create-course" onClick={() => change(createLayout(props.course))}>{t("courses.create")}</button>
      <button data-testid="add-estate-hole" disabled={props.course.holes.length >= 36} onClick={() => change(addEstateHole(props.course, active.id))}>{t("courses.addHole")}</button>
    </div>
    {layouts.map(layout => <div key={layout.id} role="tabpanel" id={panelId(layout.id)} aria-labelledby={tabId(layout.id)} hidden={layout.id !== active.id}>
      {layout.id === active.id && <>
        <section className="cc-course-manager__section" aria-labelledby={`${instanceId}-details`}>
          <h3 id={`${instanceId}-details`}>{t("courses.details")}</h3>
          <div className="cc-course-manager__fields">
            <label className="cc-course-manager__field cc-course-manager__field-wide">{t("courses.name")}<input value={active.name} onChange={(event) => change(updateLayout(props.course, active.id, { name: event.target.value }))}/></label>
            <label className="cc-course-manager__field">{t("courses.greenFee")}<input data-testid="course-green-fee" type="number" min={0} value={active.greenFee} onChange={(event) => change(updateLayout(props.course, active.id, { greenFee: Number(event.target.value) }))}/></label>
            <label className="cc-course-manager__field">{t("courses.operating")}<select value={active.state} onChange={(event) => change(updateLayout(props.course, active.id, { state: event.target.value === "closed" ? "closed" : "open" }))}><option value="open">{t("courses.openState")}</option><option value="closed">{t("courses.closedState")}</option></select></label>
          </div>
          <p className="cc-course-manager__summary">{t("courses.routeSummary", { draft: active.draftHoleIds.length, published: active.publishedHoleIds.length })}</p>
        </section>
        {metrics && <section data-testid="course-metrics" className="cc-course-manager__section" aria-labelledby={`${instanceId}-metrics`}><h3 id={`${instanceId}-metrics`}>{t("courses.metrics")}</h3><p>{t("courses.metricLine", { rating: metrics.rating.toFixed(1), slope: metrics.slope, quality: Math.round(metrics.quality), demand: metrics.demand.toFixed(2), visitors: metrics.dailyVisitors, capacity: metrics.dailyCapacity })}</p></section>}
        <section data-testid="architect-report" aria-labelledby={`${instanceId}-architecture`} className="cc-course-manager__section cc-course-manager__architecture">
          <div className="cc-course-manager__score-heading">
            <h3 id={`${instanceId}-architecture`}>{t("architecture.title")}</h3>
            <strong data-testid="architecture-total" aria-label={t("architecture.totalLabel", { score: architecture.total })}>{architecture.total}</strong>
          </div>
          <p>{t("architecture.subtitle")}</p>
          <div className="cc-course-manager__components">{Object.values(architecture.components).map(item => <div key={item.id} data-testid={`architecture-${item.id}`}>
            <div className="cc-course-manager__component-heading"><strong>{t(`architecture.component.${item.id}` as MessageKey)}</strong><span>{Math.round(item.score)} · {Math.round(item.weight * 100)}%</span></div>
            <progress max={100} value={item.score} aria-label={`${t(`architecture.component.${item.id}` as MessageKey)}: ${Math.round(item.score)}`} />
            <small>{componentCopy(item)}</small>
          </div>)}</div>
          <h4>{t("architecture.findings", { count: architecture.warnings.length })}</h4>
          {architecture.warnings.length ? <ul data-testid="architecture-warnings" className="cc-course-manager__warnings">{architecture.warnings.map(warning => <li key={warning.id}>
            <button onClick={() => { const holeId = warning.holeIds[0]; if (holeId) props.onSelectHole(holeId); if (warning.location) props.onCenter(warning.location); }}>
              <strong>{t(`architecture.warning.${warning.kind}` as MessageKey)}</strong><small>{warning.measurement} · {t("architecture.jump")}</small>
            </button>
          </li>)}</ul> : <p>{t("architecture.noWarnings")}</p>}
          <div className="cc-course-manager__actions">
            <button onClick={() => props.onOpenGolfopedia("management-architecture")}>{t("architecture.learn")}</button>
            <button data-testid="architecture-review-from-report" onClick={props.onOpenArchitectureReview}>{t("architecture.review.open")}</button>
          </div>
        </section>
        <section className="cc-course-manager__section" aria-labelledby={`${instanceId}-draft`}>
          <h3 id={`${instanceId}-draft`}>{t("courses.draft")}</h3>
          <ol data-testid="draft-routing" className="cc-course-manager__routing">{active.draftHoleIds.map((holeId, index) => {
            const hole = props.course.holes.find(candidate => candidate.id === holeId);
            return <li key={holeId} data-hole-id={holeId}>
              <div className="cc-course-manager__routing-row"><button className="cc-course-manager__hole" onClick={() => props.onSelectHole(holeId)}>{hole?.name ?? holeId}</button>
                <div className="cc-course-manager__row-actions"><button aria-label={t("courses.up")} disabled={index === 0} onClick={() => reorder(index, -1)}>↑</button><button aria-label={t("courses.down")} disabled={index === active.draftHoleIds.length - 1} onClick={() => reorder(index, 1)}>↓</button><button aria-label={t("courses.remove")} onClick={() => change(updateLayout(props.course, active.id, { draftHoleIds: active.draftHoleIds.filter(id => id !== holeId) }))}>−</button></div>
              </div>
            </li>;
          })}</ol>
          {available.length ? <div className="cc-course-manager__assignment"><label className="cc-course-manager__field">{t("courses.unassigned")}<select value={selectedHole} onChange={(event) => setSelectedHole(event.target.value)}><option value="">—</option>{available.map(hole => <option key={hole.id} value={hole.id}>{hole.name ?? hole.id}</option>)}</select></label><button disabled={!selectedHole} onClick={() => { if (selectedHole) { change(assignHoleToLayout(props.course, active.id, selectedHole)); setSelectedHole(""); } }}>{t("courses.assign")}</button></div> : <p>{t("courses.none")}</p>}
          {!validation.valid && <ul data-testid="routing-errors" className="cc-course-manager__errors">{validation.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
          <button data-testid="publish-routing" className="cc-course-manager__publish" disabled={!validation.valid} onClick={() => { const result = publishLayout(props.course, active.id); change(result.course); setMessage(result.reasons[0] ?? t("courses.publishedSuccess")); }}>{t("courses.publish")}</button>
          {message && <p role="status" className="cc-course-manager__status">{message}</p>}
        </section>
        <section className="cc-course-manager__section" aria-labelledby={`${instanceId}-published`}><h3 id={`${instanceId}-published`}>{t("courses.published")}</h3><ol data-testid="published-routing" className="cc-course-manager__published">{active.publishedHoleIds.map(id => <li key={id}>{props.course.holes.find(hole => hole.id === id)?.name ?? id}</li>)}</ol></section>
      </>}
    </div>)}
  </aside>;
}

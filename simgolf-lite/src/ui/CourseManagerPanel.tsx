import { useState } from "react";
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
} from "../game/models/courseLayouts";
import { useI18n } from "../i18n/useI18n";
import { courseOperationalMetrics } from "../game/sim/courseOperations";

export function CourseManagerPanel(props: {
  course: Course;
  world: World;
  onChange: (course: Course) => void;
  onSelectHole: (holeId: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const layouts = courseLayouts(props.course);
  const active = layouts.find((layout) => layout.id === props.course.activeCourseId) ?? layouts[0];
  const [selectedHole, setSelectedHole] = useState("");
  const [message, setMessage] = useState("");
  const assigned = new Set(layouts.flatMap((layout) => layout.draftHoleIds));
  const available = props.course.holes.filter((hole) => hole.id && !assigned.has(hole.id));
  const validation = validateDraftRouting(props.course, active.id);
  const metrics = courseOperationalMetrics(props.course, props.world, active.id)[0];

  const change = (course: Course) => props.onChange(course);
  const reorder = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= active.draftHoleIds.length) return;
    const ids = [...active.draftHoleIds];
    [ids[index], ids[target]] = [ids[target], ids[index]];
    change(updateLayout(props.course, active.id, { draftHoleIds: ids }));
  };

  return <aside role="dialog" aria-modal="false" aria-label={t("courses.title")} data-testid="course-manager" style={{ position: "absolute", inset: "58px 12px 12px auto", width: 390, maxWidth: "calc(100% - 24px)", zIndex: 145, overflow: "auto", padding: 14, borderRadius: 12, border: "2px solid #765d38", background: "#fff8e7", boxShadow: "0 12px 36px #1f2c2388", color: "#26362d" }}>
    <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}><h2 style={{ margin: 0 }}>{t("courses.title")}</h2><button aria-label={t("courses.close")} onClick={props.onClose}>×</button></header>
    <div role="tablist" style={{ display: "flex", gap: 6, overflowX: "auto", margin: "12px 0" }}>{layouts.map((layout) => <button key={layout.id} role="tab" aria-selected={layout.id === active.id} onClick={() => { change(selectLayout(props.course, layout.id)); setMessage(""); }}>{layout.name}</button>)}</div>
    <button data-testid="create-course" onClick={() => change(createLayout(props.course))}>{t("courses.create")}</button>
    <button data-testid="add-estate-hole" disabled={props.course.holes.length >= 36} onClick={() => change(addEstateHole(props.course, active.id))} style={{ marginLeft: 6 }}>{t("courses.addHole")}</button>
    <label style={{ display: "grid", gap: 4, marginTop: 12 }}>{t("courses.name")}<input value={active.name} onChange={(event) => change(updateLayout(props.course, active.id, { name: event.target.value }))}/></label>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
      <label style={{ display: "grid", gap: 4 }}>{t("courses.greenFee")}<input data-testid="course-green-fee" type="number" min={0} value={active.greenFee} onChange={(event) => change(updateLayout(props.course, active.id, { greenFee: Number(event.target.value) }))}/></label>
      <label style={{ display: "grid", gap: 4 }}>{t("courses.operating")}<select value={active.state} onChange={(event) => change(updateLayout(props.course, active.id, { state: event.target.value === "closed" ? "closed" : "open" }))}><option value="open">{t("courses.openState")}</option><option value="closed">{t("courses.closedState")}</option></select></label>
    </div>
    <p>{t("courses.routeSummary", { draft: active.draftHoleIds.length, published: active.publishedHoleIds.length })}</p>
    {metrics && <section data-testid="course-metrics"><h3>{t("courses.metrics")}</h3><p>{t("courses.metricLine", { rating: metrics.rating.toFixed(1), slope: metrics.slope, quality: Math.round(metrics.quality), demand: metrics.demand.toFixed(2), visitors: metrics.dailyVisitors, capacity: metrics.dailyCapacity })}</p></section>}
    <h3>{t("courses.draft")}</h3>
    <ol data-testid="draft-routing" style={{ display: "grid", gap: 6, paddingLeft: 24 }}>{active.draftHoleIds.map((holeId, index) => {
      const hole = props.course.holes.find((candidate) => candidate.id === holeId);
      return <li key={holeId}><button onClick={() => props.onSelectHole(holeId)}>{hole?.name ?? holeId}</button><span style={{ float: "right", display: "flex", gap: 3 }}><button aria-label={t("courses.up")} disabled={index === 0} onClick={() => reorder(index, -1)}>↑</button><button aria-label={t("courses.down")} disabled={index === active.draftHoleIds.length - 1} onClick={() => reorder(index, 1)}>↓</button><button aria-label={t("courses.remove")} onClick={() => change(updateLayout(props.course, active.id, { draftHoleIds: active.draftHoleIds.filter((id) => id !== holeId) }))}>−</button></span></li>;
    })}</ol>
    {available.length ? <div style={{ display: "flex", gap: 6 }}><label style={{ flex: 1 }}>{t("courses.unassigned")}<select value={selectedHole} onChange={(event) => setSelectedHole(event.target.value)}><option value="">—</option>{available.map((hole) => <option key={hole.id} value={hole.id}>{hole.name ?? hole.id}</option>)}</select></label><button disabled={!selectedHole} onClick={() => { if (selectedHole) { change(assignHoleToLayout(props.course, active.id, selectedHole)); setSelectedHole(""); } }}>{t("courses.assign")}</button></div> : <p>{t("courses.none")}</p>}
    {!validation.valid && <ul data-testid="routing-errors" style={{ color: "#8b2f24" }}>{validation.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
    <button data-testid="publish-routing" disabled={!validation.valid} onClick={() => { const result = publishLayout(props.course, active.id); change(result.course); setMessage(result.reasons[0] ?? t("courses.publishedSuccess")); }}>{t("courses.publish")}</button>
    {message && <p role="status">{message}</p>}
    <h3>{t("courses.published")}</h3><ol>{active.publishedHoleIds.map((id) => <li key={id}>{props.course.holes.find((hole) => hole.id === id)?.name ?? id}</li>)}</ol>
  </aside>;
}

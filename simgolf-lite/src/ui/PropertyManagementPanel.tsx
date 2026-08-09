import { useEffect, useMemo, useState } from "react";
import { formatCurrency, formatNumber } from "../i18n/format";
import { TEE_SETS, type Course, type World } from "../game/models/types";
import {
  FACILITY_MODULE_SPECS,
  PROPERTY_ASSET_SPECS,
  propertyOutingPreview,
  propertyPackagePreview,
  propertyAssetValuationBreakdown,
  residentialDevelopmentPreview,
  propertySummary,
  propertyUpgradePreview,
  type PropertyCommand,
  type PropertyCommandResult,
} from "../game/property/property";
import type { FacilityModuleKind, LodgingReservation, OutingBooking, PropertyAsset, PropertyAssetCategory, PropertyAssetKind, ResidentialStrategy } from "../game/property/types";
import { translateCurrent } from "../i18n/core";
import { systemControlEnvelope } from "../game/experience/systemControl";

type Tab = "campus" | "resort" | "community" | "ledger";

const TAB_COPY: Record<Tab, { icon: string; label: string; categories: PropertyAssetCategory[] }> = {
  campus: { icon: "🏌️", label: "Club campus", categories: ["access", "practice", "clubhouse"] },
  resort: { icon: "🏨", label: "Destination", categories: ["resort"] },
  community: { icon: "🏘️", label: "Community", categories: ["community", "safety"] },
  ledger: { icon: "📒", label: "Ledger", categories: [] },
};

const CATEGORY_COPY: Partial<Record<PropertyAssetCategory, { title: string; help: string }>> = {
  access: { title: "Arrival and access", help: "Road and parking capacity is shared by golfers, practice customers, diners, event guests, hotel guests, and residents. Surface and condition both affect throughput." },
  practice: { title: "Practice academy", help: "Buckets, bays, putting, short game, and practice holes create direct revenue while improving customer skill and loyalty." },
  clubhouse: { title: "Clubhouse rooms", help: "The clubhouse shell unlocks revenue modules. Dining and retail draw from every visitor stream; lockers support memberships and outings." },
  resort: { title: "Overnight resort", help: "Lodging creates stay-and-play guests who also spend on golf, practice, dining, retail, spa, and events." },
  community: { title: "Golf community", help: "Home sales provide capital and residents become recurring customers, but occupied homes introduce ball-strike exposure." },
  safety: { title: "Safety and neighbor relations", help: "Buffers and netting reduce claims and complaints from errant shots near houses and condominiums." },
};

export function PropertyManagementPanel(props: {
  course: Course;
  world: World;
  onCommand: (command: PropertyCommand) => PropertyCommandResult;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("campus");
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [referenceReady, setReferenceReady] = useState(false);
  useEffect(() => {
    let canceled = false;
    setReferenceReady(false);
    void import("../game/architecture/referencePlan").then(({ architectureReferencePlans }) => {
      for (const teeSet of TEE_SETS) architectureReferencePlans(props.course, teeSet, props.course.activePinRotation ?? "A");
      if (!canceled) setReferenceReady(true);
    }).catch(() => { if (!canceled) setReferenceReady(true); });
    return () => { canceled = true; };
    // Property-only root updates retain the same geometry and reference plans.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.course.activePinRotation, props.course.buildings, props.course.elevations, props.course.holes, props.course.obstacles, props.course.tiles, props.course.yardsPerTile]);
  const summary = useMemo(() => {
    void referenceReady;
    return propertySummary(props.course, props.world);
  }, [props.course, props.world, referenceReady]);
  const control = useMemo(() => systemControlEnvelope(props.world), [props.world]);
  const full = (id: "property" | "resort" | "community") => control.systems.find((system) => system.id === id)?.visibility === "full";
  const propertyDetail = full("property");
  const resortDetail = full("resort");
  const communityDetail = full("community");
  const availableTabs = (Object.keys(TAB_COPY) as Tab[]).filter((candidate) => candidate !== "ledger" || propertyDetail);
  const activeTab = availableTabs.includes(tab) ? tab : "campus";
  const run = (command: PropertyCommand) => {
    const result = props.onCommand(command);
    setNotice({ ok: result.ok, message: result.message });
  };
  const tabInfo = TAB_COPY[activeTab];

  if (!referenceReady) return <section role="dialog" aria-label={translateCurrent("property.aria")} data-testid="property-management-panel" aria-busy="true" className="cc-tycoon-panel"><button aria-label={translateCurrent("property.close")} onClick={props.onClose} style={closeButton}>✕</button>{translateCurrent("deferredSurface.loading", { surface: translateCurrent("property.aria") })}</section>;

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-label={translateCurrent("property.aria")}
      data-testid="property-management-panel"
      className="cc-tycoon-panel"
      style={{ position: "absolute", zIndex: 1200, top: 58, left: 12, width: "min(720px, calc(100vw - 24px))", maxHeight: "calc(100vh - 70px)", overflow: "hidden", display: "flex", flexDirection: "column", border: "3px solid #7b5b2d", boxShadow: "0 18px 50px rgba(20,28,20,.38)" }}
    >
      <header style={{ padding: "14px 16px 10px", background: "linear-gradient(135deg,#f9edcc,#e4d09d)", borderBottom: "1px solid rgba(70,55,25,.28)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".12em", color: "#74623f", textTransform: "uppercase" }}>{translateCurrent("property.eyebrow")}</div>
            <h2 style={{ margin: "2px 0 3px", color: "#334438" }}>{translateCurrent("property.title")}</h2>
            <div style={{ fontSize: 12, color: "#5d685d" }}>{translateCurrent("property.subtitle")}</div>
          </div>
          <button aria-label={translateCurrent("property.close")} onClick={props.onClose} style={closeButton}>✕</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(70px,1fr))", gap: 7, marginTop: 12 }}>
          <Metric label={translateCurrent("property.metric.cash")} value={formatCurrency(props.world.cash)} />
          <Metric label={translateCurrent("property.metric.arrival")} value={formatNumber(summary.accessCapacity)} />
          <Metric label={translateCurrent("property.metric.assets")} value={formatNumber(summary.assets.length)} />
          <Metric label={translateCurrent("property.metric.customers")} value={formatNumber(summary.enterprise.customers.length)} />
          <Metric label={translateCurrent("property.metric.homes")} value={formatNumber(summary.occupiedHomes)} />
          <Metric label={translateCurrent("property.metric.complaints")} value={formatNumber(summary.openComplaints)} warning={summary.openComplaints > 0} />
        </div>
      </header>

      <nav aria-label={translateCurrent("property.sections")} style={{ display: "grid", gridTemplateColumns: `repeat(${availableTabs.length},1fr)`, gap: 5, padding: 8, background: "#f7f3e8", borderBottom: "1px solid #d7cfbd" }}>
        {availableTabs.map((key) => <button key={key} data-testid={`property-tab-${key}`} aria-pressed={activeTab === key} onClick={() => setTab(key)} style={{ ...tabButton, ...(activeTab === key ? activeTabButton : {}) }}>{TAB_COPY[key].icon} {TAB_COPY[key].label}</button>)}
      </nav>

      {notice && <div role="status" data-testid="property-notice" style={{ padding: "8px 13px", fontSize: 12, fontWeight: 800, color: notice.ok ? "#245c34" : "#8a332b", background: notice.ok ? "#e7f3e7" : "#fbe9e5", borderBottom: "1px solid rgba(50,50,50,.12)" }}>{notice.message}</div>}

      <div style={{ overflowY: "auto", padding: 12, background: "rgba(255,252,243,.96)" }}>
        {activeTab !== "ledger" && <PropertyMap course={props.course} summary={summary} />}
        {activeTab === "ledger" ? <LedgerView summary={summary} world={props.world} /> : tabInfo.categories.map((category) => {
          const copy = CATEGORY_COPY[category]!;
          const kinds = (Object.keys(PROPERTY_ASSET_SPECS) as PropertyAssetKind[]).filter((kind) => PROPERTY_ASSET_SPECS[kind].category === category && !(activeTab === "community" && (kind === "houses" || kind === "condos")));
          const detailed = category === "resort" ? resortDetail : category === "community" || category === "safety" ? communityDetail : propertyDetail;
          return <section key={category} style={{ marginTop: 14 }}>
            <div style={{ marginBottom: 7 }}>
              <h3 style={{ margin: 0, fontSize: 15, color: "#3e4c40" }}>{copy.title}</h3>
              <div data-tooltip={copy.help} style={{ fontSize: 11, color: "#677267", cursor: "help" }}>{copy.help}</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
              {kinds.map((kind) => <AssetCard key={kind} course={props.course} kind={kind} asset={summary.assets.find((candidate) => candidate.kind === kind)} detailed={detailed} onCommand={run} />)}
            </div>
          </section>;
        })}

        {activeTab === "campus" && <section style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <ActionCard icon="🧑‍🏫" title={translateCurrent("property.professionals")} detail={`${summary.enterprise.professionals.length} hired · lessons improve customer skill and generate academy income.`} button="Hire professional · $4,000" onClick={() => run({ type: "HIRE_PRO" })} />
          <ActionCard icon="🎟️" title={translateCurrent("property.memberships")} detail={summary.enterprise.membership.active ? `Tier ${summary.enterprise.membership.tier} · ${summary.enterprise.membership.memberCount} members · ${formatCurrency(summary.enterprise.membership.monthlyFee)}/month` : "Recurring dues, repeat play, practice access, and clubhouse demand."} button={summary.enterprise.membership.active ? "Upgrade program" : "Launch · $2,500"} onClick={() => run({ type: summary.enterprise.membership.active ? "UPGRADE_MEMBERSHIP" : "LAUNCH_MEMBERSHIP" })} />
        </section>}
        {activeTab === "campus" && <ShellModules assets={summary.assets} onCommand={run} />}
        {activeTab === "campus" && <OutingPlanner course={props.course} world={props.world} outings={summary.enterprise.outings} onCommand={run} />}
        {activeTab === "resort" && <section style={{ marginTop: 14 }}>
          {resortDetail && <>
          <h3 style={{ marginBottom: 5 }}>{translateCurrent("property.resort.operations")}</h3>
          <div style={{ fontSize: 11, color: "#687168", marginBottom: 8 }}>{translateCurrent("property.resort.help")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
            <ActionCard testId="resort-staff-front-desk" icon="🛎️" title={translateCurrent("property.resort.frontDesk")} detail={`${summary.enterprise.resort.frontDesk} staffed`} button="Hire · $2,500" onClick={() => run({ type: "HIRE_SERVICE", role: "frontDesk" })} />
            <ActionCard testId="resort-staff-housekeeping" icon="🧹" title={translateCurrent("property.resort.housekeeping")} detail={`${summary.enterprise.resort.housekeeping} staffed · ${summary.enterprise.resort.dirtyRooms} dirty · ${summary.enterprise.resort.outOfOrderRooms} out of order`} button="Hire · $2,500" onClick={() => run({ type: "HIRE_SERVICE", role: "housekeeping" })} />
            <ActionCard testId="resort-staff-maintenance" icon="🔧" title={translateCurrent("property.resort.maintenance")} detail={translateCurrent("property.resort.maintenanceDetail", { count: summary.enterprise.resort.maintenance })} button="Hire · $2,500" onClick={() => run({ type: "HIRE_SERVICE", role: "maintenance" })} />
            <ActionCard testId="resort-staff-concierge" icon="🧳" title={translateCurrent("property.resort.concierge")} detail={translateCurrent("property.resort.conciergeDetail", { count: summary.enterprise.resort.concierge })} button="Hire · $2,500" onClick={() => run({ type: "HIRE_SERVICE", role: "concierge" })} />
            <ActionCard testId="resort-staff-shuttle" icon="🚌" title={translateCurrent("property.resort.shuttle")} detail={`${summary.enterprise.resort.shuttleDrivers} drivers · ${summary.enterprise.resort.transportWaitMinutes} min current wait`} button="Hire · $2,500" onClick={() => run({ type: "HIRE_SERVICE", role: "shuttleDrivers" })} />
            <ActionCard testId="resort-staff-food" icon="🍽️" title={translateCurrent("property.resort.food")} detail={`${summary.enterprise.resort.foodService} staffed`} button="Hire · $2,500" onClick={() => run({ type: "HIRE_SERVICE", role: "foodService" })} />
            <ActionCard icon="🧰" title={translateCurrent("property.resort.recovery")} detail={`${summary.enterprise.resort.serviceQueue} guests waiting for recovery`} button="Clear rooms and queues" onClick={() => run({ type: "RECOVER_SERVICE" })} />
          </div>
          </>}
          <ResortDashboard course={props.course} world={props.world} summary={summary} detailed={resortDetail} onCommand={run} />
        </section>}
        {activeTab === "community" && communityDetail && <section style={{ marginTop: 14, border: "1px solid #d4c6ae", borderRadius: 8, padding: 10, background: "#fffaf0" }}>
          <h3 style={{ margin: "0 0 5px" }}>{translateCurrent("property.safety.title")}</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6 }}><Metric label={translateCurrent("property.safety.risk")} value={`${Math.round(summary.safety.score)}/100`} warning={summary.safety.eligibility !== "safe"} /><Metric label={translateCurrent("property.safety.eligibility")} value={summary.safety.eligibility} warning={summary.safety.eligibility === "blocked"} /><Metric label={translateCurrent("property.safety.expected")} value={summary.safety.expectedExposure.toFixed(1)} /><Metric label={translateCurrent("property.safety.mitigation")} value={summary.safety.mitigation.toFixed(1)} /></div>
          <div style={{ marginTop: 7, fontSize: 11 }}><strong>{translateCurrent("property.safety.value")}</strong> {formatCurrency(summary.residentialValue)} {translateCurrent("property.safety.valueHelp")}</div>
          {summary.safety.contributions.slice(0, 4).map((item) => <div key={item.holeId} style={{ fontSize: 10, marginTop: 4 }}>{item.holeName}: {translateCurrent("property.safety.hole", { distance: item.distanceTiles.toFixed(1), expected: item.expectedRisk.toFixed(1), outlier: item.outlierRisk.toFixed(1) })}</div>)}
        </section>}
        {activeTab === "community" && <CommunityDashboard course={props.course} world={props.world} summary={summary} detailed={communityDetail} onCommand={run} />}
      </div>
    </section>
  );
}

function AssetCard(props: { course: Course; kind: PropertyAssetKind; asset?: PropertyAsset; detailed: boolean; onCommand: (command: PropertyCommand) => void }) {
  const { asset } = props;
  const spec = PROPERTY_ASSET_SPECS[props.kind];
  const preview = asset ? propertyUpgradePreview(props.course, asset.id) : null;
  return <article data-testid={`property-asset-${props.kind}`} style={{ border: "1px solid #d3cab6", borderRadius: 9, padding: 9, background: asset ? "#f7fbf3" : "#fffdf8", minHeight: 112 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
      <div><span style={{ fontSize: 18 }}>{spec.icon}</span> <strong style={{ color: "#3c483d" }}>{spec.label}</strong></div>
      {asset && <span style={{ fontSize: 10, padding: "2px 6px", height: 18, borderRadius: 999, background: "#dce9d6", fontWeight: 900 }}>{translateCurrent("property.asset.tier", { tier: asset.tier })}{asset.surface ? ` · ${asset.surface}` : ""}</span>}
    </div>
    <p style={{ margin: "5px 0 8px", minHeight: 28, fontSize: 11, color: "#697269" }}>{spec.description}</p>
    {asset ? <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 4, fontSize: 10, color: "#5a665b", marginBottom: 7 }}>
        <span>{translateCurrent("property.asset.cap", { value: asset.capacity })}</span><span>{translateCurrent("property.asset.condition", { value: Math.round(asset.condition * 100) })}</span><span>{translateCurrent("property.asset.price", { value: formatCurrency(asset.price) })}</span>
      </div>
      {(asset.constructionDaysRemaining ?? 0) > 0 && <div role="status" style={{ marginBottom: 6, padding: 5, borderRadius: 5, background: "#fff0c9", color: "#704f16", fontSize: 10, fontWeight: 800 }}>{translateCurrent("property.asset.construction", { days: asset.constructionDaysRemaining ?? 0 })}</div>}
      {asset.lastDay && <div style={{ marginBottom: 6, fontSize: 10, color: asset.lastDay.denied > 0 ? "#8a332b" : "#5a665b" }}>{translateCurrent("property.asset.lastDay", { served: asset.lastDay.served, demand: asset.lastDay.demand, denied: asset.lastDay.denied, revenue: formatCurrency(asset.lastDay.revenue) })}</div>}
      {preview && <div data-testid={`upgrade-preview-${props.kind}`} style={{ marginBottom: 6, fontSize: 9, color: preview.blocker ? "#8a332b" : "#6b6555" }}>{translateCurrent("property.asset.upgradePreview", { tier: preview.nextTier, capacity: preview.capacityDelta, upkeep: formatCurrency(preview.upkeepDelta), parking: preview.parkingDemandDelta, days: preview.downtimeDays, breakEven: preview.breakEvenVisitorsPerDay })}{preview.blocker ? translateCurrent("property.asset.blocked", { reason: preview.blocker }) : ""}</div>}
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        <button data-testid={`upgrade-${props.kind}`} onClick={() => props.onCommand({ type: "UPGRADE", assetId: asset.id })} disabled={!preview || !!preview.blocker} style={smallButton}>{!preview ? "Max tier" : `Upgrade · ${formatCurrency(preview.cost)}`}</button>
        {asset.condition < 0.94 && <button onClick={() => props.onCommand({ type: "MAINTAIN", assetId: asset.id })} style={smallButton}>{translateCurrent("property.asset.work")}</button>}
        <button aria-label={translateCurrent(asset.enabled ? "property.asset.close" : "property.asset.reopen", { name: spec.label })} onClick={() => props.onCommand({ type: "TOGGLE", assetId: asset.id })} style={smallButton}>{translateCurrent(asset.enabled ? "common.close" : "common.on")}</button>
        <span aria-label={translateCurrent("property.asset.move", { name: spec.label })} style={{ display: "inline-flex", gap: 2 }}><button title={translateCurrent("property.asset.west")} onClick={() => props.onCommand({ type: "MOVE", assetId: asset.id, dx: -1, dy: 0 })} style={smallButton}>←</button><button title={translateCurrent("property.asset.north")} onClick={() => props.onCommand({ type: "MOVE", assetId: asset.id, dx: 0, dy: -1 })} style={smallButton}>↑</button><button title={translateCurrent("property.asset.south")} onClick={() => props.onCommand({ type: "MOVE", assetId: asset.id, dx: 0, dy: 1 })} style={smallButton}>↓</button><button title={translateCurrent("property.asset.east")} onClick={() => props.onCommand({ type: "MOVE", assetId: asset.id, dx: 1, dy: 0 })} style={smallButton}>→</button></span>
        <button aria-label={translateCurrent("property.asset.remove", { name: spec.label })} onClick={() => props.onCommand({ type: "REMOVE", assetId: asset.id })} style={smallButton}>{translateCurrent("property.asset.removeShort")}</button>
        {(asset.kind === "houses" || asset.kind === "condos") && <button aria-label={translateCurrent("property.asset.buyback", { name: spec.label })} onClick={() => props.onCommand({ type: "BUYBACK", assetId: asset.id })} style={smallButton}>{translateCurrent("property.asset.buybackShort")}</button>}
        {asset.category === "practice" && <button data-testid={`rotate-${props.kind}`} onClick={() => props.onCommand({ type: "ROTATE_PRACTICE", assetId: asset.id })} style={smallButton}>{translateCurrent("property.asset.rotatePractice")}</button>}
        <input aria-label={translateCurrent("property.asset.nameLabel", { name: spec.label })} defaultValue={asset.name} maxLength={40} onBlur={(event) => {
          if (event.target.value.trim() !== asset.name) props.onCommand({ type: "RENAME", assetId: asset.id, name: event.target.value });
        }} style={{ width: 92, padding: 3, fontSize: 10, borderRadius: 5, border: "1px solid #b8b09f" }} />
        {asset.price > 0 && <label style={{ fontSize: 10, display: "flex", alignItems: "center", gap: 3 }}>{translateCurrent("property.asset.price", { value: "" })} <input aria-label={translateCurrent("property.asset.priceLabel", { name: spec.label })} type="number" min={0} value={asset.price} onChange={(event) => props.onCommand({ type: "SET_PRICE", assetId: asset.id, price: Number(event.target.value) })} style={{ width: 52, padding: 3, borderRadius: 5, border: "1px solid #b8b09f" }} /></label>}
        {props.detailed && <label style={compactLabel}>{translateCurrent("property.asset.hours")} <select aria-label={translateCurrent("property.asset.hoursLabel", { name: spec.label })} value={`${asset.openHour ?? 7}-${asset.closeHour ?? 20}`} onChange={(event) => {
          const [openHour, closeHour] = event.target.value.split("-").map(Number);
          props.onCommand({ type: "SET_HOURS", assetId: asset.id, openHour, closeHour });
        }}><option value="7-16">7–16</option><option value="7-20">7–20</option><option value="8-20">8–20</option><option value="9-23">9–23</option></select></label>}
        {props.detailed && <label style={compactLabel}>{translateCurrent("property.asset.upkeep")} <select aria-label={translateCurrent("property.asset.upkeepLabel", { name: spec.label })} value={asset.upkeepPolicy ?? "standard"} onChange={(event) => props.onCommand({ type: "SET_UPKEEP", assetId: asset.id, policy: event.target.value as "lean" | "standard" | "premium" })}><option value="lean">{translateCurrent("property.asset.lean")}</option><option value="standard">{translateCurrent("property.asset.standard")}</option><option value="premium">{translateCurrent("property.asset.premium")}</option></select></label>}
      </div>
    </> : <button data-testid={`build-${props.kind}`} onClick={() => props.onCommand({ type: "BUILD", kind: props.kind })} style={{ ...smallButton, background: "#3f6c43", color: "white", borderColor: "#315b35" }}>{translateCurrent("property.asset.build", { amount: formatCurrency(spec.buildCost) })}</button>}
  </article>;
}

function ShellModules(props: { assets: PropertyAsset[]; onCommand: (command: PropertyCommand) => void }) {
  const clubhouse = props.assets.find((asset) => asset.kind === "clubhouse");
  if (!clubhouse) return null;
  const installed = new Map((clubhouse.modules ?? []).map((module) => [module.kind, module]));
  return <section data-testid="property-shell-modules" style={{ marginTop: 14 }}>
    <h3 style={{ margin: "0 0 4px" }}>{translateCurrent("property.modules.title")}</h3>
    <div style={{ fontSize: 11, color: "#687168", marginBottom: 7 }}>{translateCurrent("property.modules.help", { tier: clubhouse.tier, slots: clubhouse.tier + 1 })}</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 6 }}>
      {(Object.keys(FACILITY_MODULE_SPECS) as FacilityModuleKind[]).map((kind) => {
        const spec = FACILITY_MODULE_SPECS[kind];
        const module = installed.get(kind);
        return <article key={kind} data-testid={`property-module-${kind}`} style={{ border: "1px solid #d4cab4", borderRadius: 7, padding: 7, background: module ? "#f0f7ea" : "#fffdf8", fontSize: 10 }}>
          <strong>{spec.label}</strong> {translateCurrent("property.modules.meta", { tier: spec.requiredShellTier, capacity: spec.capacity })}
          <div style={{ margin: "3px 0 6px", color: "#6b7269" }}>{spec.description}</div>
          <button data-testid={`${module ? "toggle" : "install"}-module-${kind}`} disabled={!module && clubhouse.tier < spec.requiredShellTier} onClick={() => props.onCommand(module ? { type: "TOGGLE_MODULE", module: kind } : { type: "INSTALL_MODULE", module: kind })} style={smallButton}>{module ? translateCurrent(module.enabled ? "property.modules.close" : "property.modules.reopen") : translateCurrent("property.modules.install", { amount: formatCurrency(spec.buildCost) })}</button>
        </article>;
      })}
    </div>
  </section>;
}

function OutingPlanner(props: { course: Course; world: World; outings: OutingBooking[]; onCommand: (command: PropertyCommand) => void }) {
  const packages: OutingBooking["package"][] = ["golf_only", "golf_clinic", "golf_catering", "destination_event"];
  const scheduled = props.outings.filter((outing) => outing.status === "scheduled");
  return <section style={{ marginTop: 14 }}>
    <h3 style={{ margin: "0 0 4px" }}>🎉 {translateCurrent("property.outing")}</h3>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 6 }}>
      {packages.map((packageKind) => {
        const preview = propertyOutingPreview(props.course, props.world, packageKind);
        return <article key={packageKind} data-testid={`outing-preview-${packageKind}`} style={{ border: "1px solid #d4cab4", borderRadius: 7, padding: 8, background: preview.blockers.length ? "#fbf1e8" : "#f3f8ee", fontSize: 10 }}>
          <strong>{packageKind.replaceAll("_", " ")}</strong>
          <div>{translateCurrent("property.outing.preview", { guests: preview.guests, gross: formatCurrency(preview.gross), cost: formatCurrency(preview.variableCost), parking: preview.parkingDemand })}</div>
          {preview.blockers.length > 0 && <div style={{ marginTop: 4, color: "#8a332b" }}>{preview.blockers.join(" ")}</div>}
          <button disabled={preview.blockers.length > 0} onClick={() => props.onCommand({ type: "BOOK_OUTING", package: packageKind })} style={{ ...smallButton, marginTop: 6 }}>{translateCurrent("property.outing.book", { deposit: formatCurrency(preview.deposit) })}</button>
        </article>;
      })}
    </div>
    {scheduled.map((outing) => <div key={outing.id} style={{ marginTop: 6, padding: 7, border: "1px solid #d4cab4", borderRadius: 7, fontSize: 10 }}>{translateCurrent("property.outing.scheduled", { week: outing.week, day: outing.day + 1, package: outing.package.replaceAll("_", " "), guests: outing.guests })} <button onClick={() => props.onCommand({ type: "CANCEL_OUTING", outingId: outing.id })} style={{ ...smallButton, marginLeft: 8 }}>{translateCurrent("property.outing.cancel")}</button></div>)}
  </section>;
}

function ResortDashboard(props: { course: Course; world: World; summary: ReturnType<typeof propertySummary>; detailed: boolean; onCommand: (command: PropertyCommand) => void }) {
  const packages: LodgingReservation["package"][] = ["room_only", "stay_and_play", "academy", "event"];
  const metrics = props.summary.resortMetrics;
  const reservations = [...props.summary.enterprise.reservations].reverse().slice(0, 12);
  return <section data-testid="resort-dashboard" style={{ marginTop: 14 }}>
    {props.detailed && <><h3 style={{ margin: "0 0 6px" }}>{translateCurrent("property.resort.performance")}</h3>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 6 }}>
      <Metric label={translateCurrent("property.resort.occupancy")} value={`${Math.round(metrics.occupancyRate * 100)}% · ${metrics.occupiedRooms}/${metrics.totalRooms}`} />
      <Metric label={translateCurrent("property.resort.adr")} value={formatCurrency(metrics.averageDailyRate)} />
      <Metric label={translateCurrent("property.resort.revpar")} value={formatCurrency(metrics.revenuePerAvailableRoom)} />
      <Metric label={translateCurrent("property.resort.averageStay")} value={translateCurrent("property.resort.nights", { value: metrics.averageLengthOfStay.toFixed(1) })} />
      <Metric label={translateCurrent("property.resort.packageMargin")} value={formatCurrency(metrics.packageMargin)} warning={metrics.packageMargin < 0} />
      <Metric label={translateCurrent("property.resort.ancillarySpend")} value={formatCurrency(metrics.ancillarySpend)} />
      <Metric label={translateCurrent("property.resort.transportCost")} value={formatCurrency(metrics.transportCost)} />
      <Metric label={translateCurrent("property.resort.destinationAppeal")} value={`${metrics.destinationAppeal}/100`} warning={metrics.destinationAppeal < 45} />
    </div>
    <div data-testid="resort-capacity" style={{ marginTop: 7, padding: 7, borderRadius: 7, background: "#eef3e8", fontSize: 10 }}>
      <strong>{translateCurrent("property.resort.capacity", metrics.capacity)}</strong>
    </div></>}
    <h3 style={{ marginBottom: 5 }}>{translateCurrent("property.resort.packages")}</h3>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 6 }}>
      {packages.map((kind) => {
        const preview = propertyPackagePreview(props.course, props.world, kind);
        return <article key={kind} data-testid={`resort-package-${kind}`} style={{ border: "1px solid #d4cab4", borderRadius: 7, padding: 8, background: preview.blockers.length ? "#fbf1e8" : "#f3f8ee", fontSize: 10 }}>
          <strong>{kind.replaceAll("_", " ")} · {preview.travelerSegment}</strong>
          <div>{translateCurrent("property.resort.packageDetail", { nights: preview.nights, rooms: preview.roomCount, roomClass: preview.roomClass, guests: preview.partySize })}</div>
          <div>{translateCurrent("property.resort.packageProperty", { property: preview.lodgingName ?? translateCurrent("property.resort.noProperty"), rooms: preview.roomsRemaining, margin: formatCurrency(preview.estimatedMargin) })}</div>
          {preview.blockers.length > 0 && <div style={{ marginTop: 4, color: "#8a332b" }}>{preview.blockers.join(" ")}</div>}
          <button disabled={preview.blockers.length > 0} onClick={() => props.onCommand({ type: "BOOK_PACKAGE", package: kind })} style={{ ...smallButton, marginTop: 6 }}>{translateCurrent("property.book", { name: kind.replaceAll("_", " ") })} · {formatCurrency(preview.deposit)}</button>
        </article>;
      })}
    </div>
    {props.detailed && <><h3 style={{ marginBottom: 5 }}>{translateCurrent("property.resort.reservations")}</h3>
    {reservations.length === 0 ? <p style={{ fontSize: 11, color: "#687168" }}>{translateCurrent("property.resort.noReservations")}</p> : <div style={{ display: "grid", gap: 5 }}>
      {reservations.map((reservation) => {
        const fulfilled = reservation.entitlements?.filter((entitlement) => entitlement.status === "fulfilled" || entitlement.redeemed).length ?? 0;
        const total = reservation.entitlements?.length ?? 0;
        return <div key={reservation.id} data-testid={`resort-reservation-${reservation.id}`} style={{ padding: 7, border: "1px solid #d4cab4", borderRadius: 7, background: reservation.status === "cancelled" ? "#faeee9" : "#fffdf8", fontSize: 10 }}>
          <strong>{reservation.package.replaceAll("_", " ")} · {reservation.status ?? "booked"}</strong>
          <div>{translateCurrent("property.resort.reservationDates", { checkInWeek: reservation.checkInWeek ?? reservation.week, checkInDay: (reservation.checkInDay ?? 0) + 1, checkOutWeek: reservation.checkOutWeek ?? reservation.week, checkOutDay: (reservation.checkOutDay ?? 0) + 1, rooms: reservation.roomCount ?? 1, roomClass: reservation.roomClass ?? "standard", guests: reservation.partySize ?? 1 })}</div>
          <div>{translateCurrent("property.resort.reservationMeta", { segment: reservation.travelerSegment ?? "tourist", transport: reservation.transportMode ?? "self drive", fulfilled, total, folio: formatCurrency((reservation.folio ?? []).reduce((sum, item) => sum + item.amount, 0)) })}</div>
          {(reservation.refund ?? 0) > 0 && <div style={{ color: "#8a332b" }}>{translateCurrent("property.resort.refunded", { amount: formatCurrency(reservation.refund ?? 0), status: reservation.revalidation ?? "substituted" })}</div>}
        </div>;
      })}
    </div>}</>}
  </section>;
}

function CommunityDashboard(props: { course: Course; world: World; summary: ReturnType<typeof propertySummary>; detailed: boolean; onCommand: (command: PropertyCommand) => void }) {
  const strategies: Array<{ id: ResidentialStrategy; label: string; detail: string }> = [
    { id: "sell", label: translateCurrent("property.community.strategy.sell"), detail: translateCurrent("property.community.strategy.sellDetail") },
    { id: "retain", label: translateCurrent("property.community.strategy.retain"), detail: translateCurrent("property.community.strategy.retainDetail") },
    { id: "partner", label: translateCurrent("property.community.strategy.partner"), detail: translateCurrent("property.community.strategy.partnerDetail") },
  ];
  const openComplaints = [...props.summary.enterprise.complaints].filter((complaint) => complaint.status === "open" || complaint.status === "acknowledged").reverse().slice(0, 10);
  const openClaims = [...props.summary.enterprise.claims].filter((claim) => claim.status === "open" || claim.status === "filed").reverse().slice(0, 10);
  const residentialAssets = props.summary.assets.filter((asset) => asset.kind === "houses" || asset.kind === "condos");
  const approve = (kind: "houses" | "condos", strategy: ResidentialStrategy) => {
    const preview = residentialDevelopmentPreview(props.course, props.world, kind, strategy);
    const outcome = strategy === "partner"
      ? translateCurrent("property.community.confirm.partner", { share: Math.round(preview.partnerShare * 100) })
      : strategy === "retain"
        ? translateCurrent("property.community.confirm.retain", { rent: formatCurrency(preview.projectedWeeklyRent) })
        : translateCurrent("property.community.confirm.sell", { low: formatCurrency(preview.projectedValueLow), high: formatCurrency(preview.projectedValueHigh) });
    const consequence = translateCurrent("property.community.confirm", {
      property: translateCurrent(kind === "houses" ? "property.community.confirm.houses" : "property.community.confirm.condos"),
      units: preview.units,
      capital: formatCurrency(preview.playerCapital),
      days: preview.constructionDays + preview.releaseDays,
      outcome,
    });
    if (window.confirm(consequence)) props.onCommand({ type: "PLAN_DEVELOPMENT", kind, strategy, confirmed: true });
  };
  const toggleTee = (teeSet: "championship" | "member" | "forward") => {
    const current = props.summary.safetyPolicy.restrictedTeeSets;
    props.onCommand({ type: "SET_SAFETY_POLICY", restrictedTeeSets: current.includes(teeSet) ? current.filter((candidate) => candidate !== teeSet) : [...current, teeSet] });
  };
  return <div data-testid="m33-community-dashboard">
    <section style={{ marginTop: 14 }}>
      <h3 style={{ margin: "0 0 4px" }}>{translateCurrent("property.community.pipeline")}</h3>
      <div style={{ fontSize: 11, color: "#687168", marginBottom: 7 }}>{translateCurrent("property.community.pipelineHelp")}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 6 }}>
        {(["houses", "condos"] as const).flatMap((kind) => strategies.map((strategy) => {
          const preview = residentialDevelopmentPreview(props.course, props.world, kind, strategy.id);
          return <article key={`${kind}-${strategy.id}`} data-testid={`development-preview-${kind}-${strategy.id}`} style={{ border: "1px solid #d4cab4", borderRadius: 7, padding: 7, background: preview.blockers.length ? "#fbf1e8" : "#f3f8ee", fontSize: 10 }}>
            <strong>{translateCurrent("property.community.previewTitle", { property: translateCurrent(kind === "houses" ? "property.community.preview.houses" : "property.community.preview.condos"), strategy: strategy.label })}</strong>
            <div>{translateCurrent("property.community.previewMeta", { units: preview.units, capital: formatCurrency(preview.playerCapital), days: preview.constructionDays + preview.releaseDays })}</div>
            <div>{props.detailed
              ? translateCurrent("property.community.previewValue", { low: formatCurrency(preview.projectedValueLow), high: formatCurrency(preview.projectedValueHigh), risk: Math.round(preview.safety.score) })
              : translateCurrent("property.community.previewValueClassic", { low: formatCurrency(preview.projectedValueLow), high: formatCurrency(preview.projectedValueHigh) })}</div>
            <div style={{ marginTop: 3, color: "#687168" }}>{strategy.detail}</div>
            {preview.blockers.length > 0 && <div style={{ marginTop: 4, color: "#8a332b" }}>{preview.blockers.join(" ")}</div>}
            <button disabled={preview.blockers.length > 0} onClick={() => approve(kind, strategy.id)} style={{ ...smallButton, marginTop: 5 }}>{translateCurrent("property.community.review")}</button>
          </article>;
        }))}
      </div>
      {props.summary.developments.length > 0 && <div data-testid="development-pipeline" style={{ display: "grid", gap: 5, marginTop: 8 }}>
        {props.summary.developments.map((development) => {
          const units = props.summary.units.filter((unit) => unit.developmentId === development.id);
          const occupied = units.filter((unit) => !!unit.householdId).length;
          return <article key={development.id} style={{ border: "1px solid #cbbfa9", borderRadius: 7, padding: 7, background: "#fffdf8", fontSize: 10 }}>
            <strong>{development.name}</strong> · {translateCurrent(development.strategy === "retain" ? "property.community.tenure.retain" : development.strategy === "partner" ? "property.community.tenure.partner" : "property.community.tenure.sell")} · {development.status}
            <div>{translateCurrent("property.community.phaseProgress", { units: units.length, occupied, construction: development.constructionDaysRemaining, release: development.releaseDaysRemaining })}</div>
            <div>{translateCurrent("property.community.phaseCapital", { capital: formatCurrency(development.playerCapital), common: formatCurrency(development.commonUpkeepDaily) })}</div>
          </article>;
        })}
      </div>}
    </section>

    {props.detailed && <><section style={{ marginTop: 14, border: "1px solid #d4c6ae", borderRadius: 8, padding: 9, background: "#f8fbf3" }}>
      <h3 style={{ margin: "0 0 5px" }}>{translateCurrent("property.community.exposure")}</h3>
      <SafetyHeatmap course={props.course} summary={props.summary} />
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 7 }}>
        {(["championship", "member", "forward"] as const).map((teeSet) => <button key={teeSet} aria-pressed={props.summary.safetyPolicy.restrictedTeeSets.includes(teeSet)} onClick={() => toggleTee(teeSet)} style={{ ...smallButton, background: props.summary.safetyPolicy.restrictedTeeSets.includes(teeSet) ? "#7b3e35" : "#fffaf0", color: props.summary.safetyPolicy.restrictedTeeSets.includes(teeSet) ? "white" : "#3c493d" }}>{translateCurrent("property.community.restrict", { tee: teeSet })}</button>)}
        {props.summary.safety.contributions[0] && <button onClick={() => props.onCommand({ type: "SET_SAFETY_POLICY", closedHoleIds: [...new Set([...props.summary.safetyPolicy.closedHoleIds, props.summary.safety.contributions[0].holeId])] })} style={smallButton}>{translateCurrent("property.community.closeHole", { hole: props.summary.safety.contributions[0].holeName })}</button>}
      </div>
      <div style={{ marginTop: 5, fontSize: 10 }}>{translateCurrent("property.community.setback", { setback: Number.isFinite(props.summary.safety.measuredSetback) ? `${props.summary.safety.measuredSetback.toFixed(1)} tiles` : "n/a" })}</div>
      {props.summary.safety.blockingReasons.map((reason) => <div key={reason} style={{ color: "#8a332b", fontSize: 10 }}>{reason}</div>)}
    </section>

    {residentialAssets.map((asset) => {
      const valuation = propertyAssetValuationBreakdown(props.course, props.world, asset);
      return <section key={asset.id} data-testid={`valuation-${asset.id}`} style={{ marginTop: 10, border: "1px solid #d4c6ae", borderRadius: 8, padding: 8, background: "#fffdf8", fontSize: 10 }}>
        <strong>{translateCurrent("property.community.valuation", { name: asset.name, total: formatCurrency(valuation.total) })}</strong>
        <div>{translateCurrent("property.community.valuationDetail", { perUnit: formatCurrency(valuation.perUnit), scenery: signed(valuation.components.scenery), golf: signed(valuation.components.golf), access: signed(valuation.components.access), amenities: signed(valuation.components.amenities), prestige: signed(valuation.components.prestige), safety: signed(valuation.components.safety), traffic: signed(valuation.components.traffic), density: signed(valuation.components.density) })}</div>
      </section>;
    })}

    <section style={{ marginTop: 14 }}>
      <h3 style={{ margin: "0 0 5px" }}>{translateCurrent("property.community.residents")}</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginBottom: 7 }}>
        <Metric label={translateCurrent("property.community.households")} value={`${props.summary.enterprise.residents.length}`} />
        <Metric label={translateCurrent("property.community.satisfaction")} value={`${Math.round(props.summary.communitySatisfaction)}/100`} warning={props.summary.communitySatisfaction < 55} />
        <Metric label={translateCurrent("property.community.localSpending")} value={formatCurrency(props.summary.residentLocalSpend)} />
      </div>
      {props.summary.enterprise.residents.slice(0, 8).map((resident) => <div key={resident.id} style={{ padding: 6, marginBottom: 4, borderRadius: 6, background: "#fffdf8", border: "1px solid #ddd2bd", fontSize: 10 }}>{translateCurrent("property.community.residentRow", { archetype: resident.archetype?.replaceAll("_", " ") ?? translateCurrent("property.community.residentFallback"), home: resident.unitIds?.[0] ?? resident.assetId, satisfaction: Math.round(resident.satisfaction), golf: Math.round(resident.golfInterest ?? 0), advocacy: Math.round(resident.advocacy ?? 0), opposition: Math.round(resident.opposition ?? 0) })}</div>)}
      {props.summary.enterprise.residents.length === 0 && <div style={{ fontSize: 11, color: "#687168" }}>{translateCurrent("property.community.residentEmpty")}</div>}
    </section>

    <section style={{ marginTop: 14 }}>
      <h3 style={{ margin: "0 0 5px" }}>{translateCurrent("property.community.complaints")}</h3>
      {openComplaints.map((complaint) => <article key={complaint.id} data-testid={`complaint-${complaint.id}`} style={{ marginBottom: 6, border: "1px solid #dfc2b6", borderRadius: 7, padding: 7, background: "#fff7f2", fontSize: 10 }}>
        <strong>{translateCurrent("property.community.complaintMeta", { source: complaint.source.replaceAll("_", " "), severity: complaint.severity, recurrence: complaint.recurrence })}</strong>
        <div>{complaint.evidence}</div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 5 }}>{(["acknowledge", "compensate", "restrict", "repair", "easement"] as const).map((response) => <button key={response} onClick={() => props.onCommand({ type: "RESPOND_COMPLAINT", complaintId: complaint.id, response })} style={smallButton}>{response}</button>)}</div>
      </article>)}
      {openComplaints.length === 0 && <div style={{ fontSize: 11, color: "#687168" }}>{translateCurrent("property.community.complaintEmpty")}</div>}
    </section>

    <section style={{ marginTop: 14 }}>
      <h3 style={{ margin: "0 0 5px" }}>{translateCurrent("property.community.claims")}</h3>
      <div style={{ fontSize: 10, marginBottom: 6 }}>{translateCurrent("property.community.insurance", { deductible: formatCurrency(props.summary.enterprise.insurance.deductible), limit: formatCurrency(props.summary.enterprise.insurance.coverageLimit), premium: formatCurrency(props.summary.enterprise.insurance.dailyPremium * props.summary.enterprise.insurance.riskMultiplier), settled: props.summary.enterprise.insurance.claimsSettled })}</div>
      {openClaims.map((claim) => <article key={claim.id} data-testid={`claim-${claim.id}`} style={{ marginBottom: 5, border: "1px solid #d5c5b7", borderRadius: 7, padding: 7, background: "#fffdf8", fontSize: 10 }}>
        <strong>{translateCurrent("property.community.claimMeta", { id: claim.id, status: claim.status, damage: formatCurrency(claim.damage) })}</strong>
        <div>{translateCurrent("property.community.claimWarnings", { warnings: claim.priorWarnings, deductible: formatCurrency(claim.deductible) })}</div>
        <button onClick={() => props.onCommand({ type: claim.status === "open" ? "FILE_CLAIM" : "SETTLE_CLAIM", claimId: claim.id })} style={{ ...smallButton, marginTop: 4 }}>{translateCurrent(claim.status === "open" ? "property.community.fileClaim" : "property.community.settleClaim")}</button>
      </article>)}
      {openClaims.length === 0 && <div style={{ fontSize: 11, color: "#687168" }}>{translateCurrent("property.community.claimEmpty")}</div>}
    </section></>}
  </div>;
}

function SafetyHeatmap(props: { course: Course; summary: ReturnType<typeof propertySummary> }) {
  const cells = props.summary.safety.heatmap;
  if (cells.length === 0) return <div style={{ fontSize: 10, color: "#687168" }}>{translateCurrent("property.community.heatEmpty")}</div>;
  const colors = { low: "#8cbf7d", guarded: "#e2c65f", high: "#dc8a4b", severe: "#b24d43" } as const;
  return <svg data-testid="m33-safety-heatmap" role="img" aria-label={translateCurrent("property.community.heatAria")} viewBox={`0 0 ${props.course.width} ${props.course.height}`} style={{ width: "100%", height: 120, background: "#e8eddf", border: "1px solid #c8c3ad" }} preserveAspectRatio="none">
    {cells.map((cell) => <g key={`${cell.x}-${cell.y}`}><rect x={cell.x} y={cell.y} width="2" height="2" fill={colors[cell.class]} opacity=".8" /><title>{translateCurrent("property.community.heatCell", { class: cell.class, risk: Math.round(cell.mitigatedRisk), holes: cell.contributingHoleIds.join(", ") })}</title></g>)}
    {props.summary.easements.filter((easement) => easement.protected).map((easement) => <rect key={easement.id} x={easement.x} y={easement.y} width={easement.width} height={easement.height} fill="none" stroke="#3d5c72" strokeDasharray="1 1" strokeWidth=".7"><title>{translateCurrent("property.community.easement", { kind: easement.kind })}</title></rect>)}
  </svg>;
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${Math.round(value * 100)}%`;
}

function ActionCard(props: { testId?: string; icon: string; title: string; detail: string; button: string; onClick: () => void }) {
  return <article data-testid={props.testId} style={{ border: "1px solid #d3cab6", borderRadius: 9, padding: 10, background: "#fffdf8" }}><strong>{props.icon} {props.title}</strong><p style={{ fontSize: 11, color: "#697269", minHeight: 28 }}>{props.detail}</p><button onClick={props.onClick} style={smallButton}>{props.button}</button></article>;
}

function PropertyMap(props: { course: Course; summary: ReturnType<typeof propertySummary> }) {
  const assets = props.summary.assets;
  if (assets.length === 0) return <div data-testid="property-map" style={{ padding: 10, border: "1px dashed #aaa58f", borderRadius: 8, color: "#77705f", fontSize: 11 }}>{translateCurrent("property.map.empty")}</div>;
  const colors: Record<PropertyAssetCategory, string> = { access: "#848b86", practice: "#74a85b", clubhouse: "#b88d52", resort: "#678fa8", community: "#c58f76", safety: "#497c49" };
  return <figure data-testid="property-map" style={{ margin: 0, border: "1px solid #cfc6b2", borderRadius: 8, overflow: "hidden", background: "#dce8c8" }}>
    <svg role="img" aria-label={translateCurrent("property.map.aria")} viewBox={`0 0 ${props.course.width} ${props.course.height}`} style={{ display: "block", width: "100%", height: 112 }} preserveAspectRatio="none">
      <defs><pattern id="private-land-hatch" width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V2" stroke="#56372f" strokeWidth=".45" /></pattern><pattern id="committed-land-hatch" width="3" height="3" patternUnits="userSpaceOnUse"><path d="M0 0L3 3M3 0L0 3" stroke="#7a6635" strokeWidth=".35" /></pattern></defs>
      <rect width={props.course.width} height={props.course.height} fill="#dce8c8" />
      {assets.map((asset) => <g key={asset.id}><rect x={asset.x} y={asset.y} width={asset.width} height={asset.height} rx="1" fill={colors[asset.category]} stroke={asset.tenure === "sold" || asset.tenure === "partnered" ? "#56372f" : asset.tenure === "reacquired" ? "#315b35" : "#fff"} strokeDasharray={asset.tenure === "reacquired" ? "1 1" : undefined} strokeWidth=".7" opacity={asset.enabled ? 0.92 : 0.56} />{(asset.tenure === "sold" || asset.tenure === "partnered" || asset.tenure === "retained") && <rect x={asset.x} y={asset.y} width={asset.width} height={asset.height} rx="1" fill="url(#private-land-hatch)" />}{asset.tenure === "committed" && <rect x={asset.x} y={asset.y} width={asset.width} height={asset.height} rx="1" fill="url(#committed-land-hatch)" />}<text x={asset.x + .5} y={asset.y + 1.5} fontSize="1.35" fontWeight="900" fill="#fff">{asset.tenure === "sold" ? "S" : asset.tenure === "retained" ? "R" : asset.tenure === "partnered" ? "P" : asset.tenure === "committed" ? "C" : asset.tenure === "reacquired" ? "↺" : ""}</text><title>{translateCurrent("property.map.asset", { name: asset.name, tier: asset.tier })}{asset.tenure ? ` · ${translateCurrent("property.community.mapTenure", { tenure: asset.tenure })}` : ""}</title></g>)}
      {props.summary.easements.filter((easement) => easement.protected).map((easement) => <rect key={easement.id} x={easement.x} y={easement.y} width={easement.width} height={easement.height} fill="none" stroke="#314e6b" strokeDasharray="1 1" strokeWidth=".8"><title>{translateCurrent("property.community.easementProtected", { kind: easement.kind })}</title></rect>)}
    </svg>
    <figcaption style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "5px 8px", fontSize: 9, background: "#f8f5ea" }}>{Object.entries(colors).map(([category, color]) => <span key={category}><i style={{ display: "inline-block", width: 7, height: 7, background: color, marginRight: 3 }} />{category}</span>)}<span>{translateCurrent("property.community.legendCommitted")}</span><span>{translateCurrent("property.community.legendSold")}</span><span>{translateCurrent("property.community.legendRental")}</span><span>{translateCurrent("property.community.legendPartner")}</span><span>{translateCurrent("property.community.legendReacquired")}</span><span>{translateCurrent("property.community.legendEasement")}</span></figcaption>
  </figure>;
}

function LedgerView(props: { summary: ReturnType<typeof propertySummary>; world: World }) {
  const entries = [...props.summary.enterprise.ledger].reverse().slice(0, 60);
  const net = props.summary.recentRevenue - props.summary.recentCosts;
  return <div data-testid="property-ledger">
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 12 }}>
      <Metric label={translateCurrent("property.ledger.revenue")} value={formatCurrency(props.summary.recentRevenue)} />
      <Metric label={translateCurrent("property.ledger.costs")} value={formatCurrency(props.summary.recentCosts)} warning={props.summary.recentCosts > props.summary.recentRevenue} />
      <Metric label={translateCurrent("property.ledger.net")} value={formatCurrency(net)} warning={net < 0} />
      <Metric label={translateCurrent("property.ledger.skill")} value={`${Math.round(props.summary.averageCustomerSkill)}/100`} />
    </div>
    <h3 style={{ margin: "0 0 7px" }}>{translateCurrent("property.ledger.title")}</h3>
    {entries.length === 0 ? <p style={{ fontSize: 12, color: "#6b746b" }}>{translateCurrent("property.ledger.empty")}</p> : <div style={{ display: "grid", gap: 4 }}>{entries.map((entry) => <div key={entry.id} style={{ display: "grid", gridTemplateColumns: "62px 92px 1fr 75px", gap: 6, fontSize: 10, padding: 6, borderRadius: 5, background: entry.cost > entry.revenue ? "#faeee9" : "#f3f7ed" }}><span>{translateCurrent("property.ledger.when", { week: entry.week, day: entry.day + 1 })}</span><b>{entry.category.replaceAll("_", " ")}</b><span>{entry.description}{entry.visitors ? ` · ${entry.visitors} guests` : ""}</span><strong style={{ textAlign: "right", color: entry.revenue - entry.cost >= 0 ? "#28603a" : "#973e35" }}>{formatCurrency(entry.revenue - entry.cost)}</strong></div>)}</div>}
    {props.summary.enterprise.incidents.length > 0 && <><h3 style={{ marginBottom: 7 }}>{translateCurrent("property.ledger.incidents")}</h3>{[...props.summary.enterprise.incidents].reverse().slice(0, 8).map((incident) => <div key={incident.id} style={{ fontSize: 11, marginBottom: 4, color: "#7b332e" }}>{translateCurrent("property.ledger.incident", { week: incident.week, description: incident.description, cost: formatCurrency(incident.cost) })}</div>)}</>}
  </div>;
}

function Metric(props: { label: string; value: string; warning?: boolean }) {
  return <div style={{ padding: "6px 7px", background: props.warning ? "#f8e2dc" : "rgba(255,255,255,.68)", border: "1px solid rgba(76,67,45,.15)", borderRadius: 7, minWidth: 0 }}><div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: ".07em", color: "#766d59", whiteSpace: "nowrap" }}>{props.label}</div><strong style={{ color: props.warning ? "#8a332b" : "#344338", fontSize: 12 }}>{props.value}</strong></div>;
}

const closeButton = { border: "1px solid #88754d", borderRadius: 8, background: "#fffaf0", padding: "7px 10px", cursor: "pointer", fontWeight: 900 } as const;
const tabButton = { border: "1px solid #c9c0ae", borderRadius: 7, padding: "7px 5px", background: "#fffdf8", color: "#536054", fontWeight: 800, fontSize: 11, cursor: "pointer" } as const;
const activeTabButton = { background: "#466d49", color: "white" } as const;
const smallButton = { border: "1px solid #9c927e", borderRadius: 6, padding: "5px 7px", background: "#fffaf0", color: "#3c493d", fontWeight: 800, fontSize: 10, cursor: "pointer" } as const;
const compactLabel = { fontSize: 10, display: "flex", alignItems: "center", gap: 3 } as const;

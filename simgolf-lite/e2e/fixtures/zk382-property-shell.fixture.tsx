import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { PropertyManagementPanel } from "../../src/ui/PropertyManagementPanel";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../../src/game/models/defaults";
import { applyPropertyCommand, propertySummary, type PropertyCommand } from "../../src/game/property/property";
import { createSystemControlState } from "../../src/game/experience/systemControl";
import type { CommunityComplaint } from "../../src/game/property/types";
import type { Course, ExperienceProfile, World } from "../../src/game/models/types";
import { formatCurrency, formatNumber } from "../../src/i18n/format";
import { loadLocale, setActiveLocale } from "../../src/i18n/core";
import "../../src/index.css";
const locale = loadLocale(); setActiveLocale(locale); document.documentElement.dataset.locale = locale;
const params = new URLSearchParams(location.search);
const profile = params.get("profile") === "relaxed" ? "relaxed" : params.get("profile") === "classic" ? "classic" : "simulation";
const course: Course = structuredClone(DEFAULT_COURSE);
const complaint: CommunityComplaint = { id: "complaint-observed", householdId: "neighbor-observed", assetId: "property-road-starter", week: 1, day: 0, source: "traffic", severity: 2, recurrence: 1, evidence: "Observed arrival traffic at the shared road", location: { x: 4, y: 4 }, status: "open" };
const world: World = { ...structuredClone(DEFAULT_WORLD), cash: params.has("long") ? 987654321098765 : 500000, reputation: 82, enterprise: { ...structuredClone(DEFAULT_WORLD.enterprise!), complaints: [complaint] }, experienceProfile: profile, systemControl: createSystemControlState(profile) };
const original = JSON.stringify({ course, world });
interface PropertyFixture { results: () => { ok: boolean; message: string }[]; calls: () => PropertyCommand[]; immutable: () => boolean; profile: (profile: ExperienceProfile) => void; focus: (system: "memberships" | "property" | "resort" | "community") => void; metrics: () => string[] }
declare global { interface Window { __propertyShellFixture: PropertyFixture } }
export function Fixture() {
  const [currentWorld, setCurrentWorld] = useState(world); const [open, setOpen] = useState(true); const [closes, setCloses] = useState(0);
  const [operationsFocus, setOperationsFocus] = useState<{ system: "memberships" | "property" | "resort" | "community"; nonce: number }>();
  const results = useRef<{ ok: boolean; message: string }[]>([]);
  const calls = useRef<PropertyCommand[]>([]); const nonce = useRef(0);
  useEffect(() => { window.__propertyShellFixture = {
    results: () => structuredClone(results.current), calls: () => structuredClone(calls.current), immutable: () => JSON.stringify({ course, world }) === original,
    profile: next => setCurrentWorld(previous => ({ ...previous, experienceProfile: next, systemControl: createSystemControlState(next) })),
    focus: system => setOperationsFocus({ system, nonce: ++nonce.current }),
    metrics: () => { const summary = propertySummary(course, currentWorld); return [formatCurrency(currentWorld.cash), formatNumber(summary.accessCapacity), formatNumber(summary.assets.length), formatNumber(summary.enterprise.customers.length), formatNumber(summary.occupiedHomes), formatNumber(summary.openComplaints)]; },
  }; }, [currentWorld]);
  return <><button data-testid="outside-before" onClick={() => setOpen(true)}>Open property</button><output data-testid="close-count">{closes}</output>{open && <PropertyManagementPanel course={course} world={currentWorld} operationsFocus={operationsFocus} onCommand={command => {
    calls.current.push(structuredClone(command));
    // Use the authoritative result contract without installing returned domain state.
    const result = applyPropertyCommand(course, params.has("failure") ? { ...currentWorld, cash: 0 } : currentWorld, command);
    results.current.push({ ok: result.ok, message: result.message });
    return result;
  }} onClose={() => { setOpen(false); setCloses(previous => previous + 1); }} />}<button data-testid="outside-after" style={{ position: "fixed", bottom: 4, right: 4 }}>Outside focus destination</button></>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);

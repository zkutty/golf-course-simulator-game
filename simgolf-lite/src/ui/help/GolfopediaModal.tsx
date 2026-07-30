import { useEffect, useMemo, useRef, useState } from "react";
import { GameTabs } from "../gameui";
import { buildGolfopediaEntries, type GolfopediaSection } from "./golfopediaData";
import { BINDING_ACTIONS, BINDING_LABEL_KEYS, displayBinding } from "../../accessibility/keybindings";
import { loadAppProfile } from "../../game/onboarding/profile";
import { useFocusTrap } from "../accessibility/useFocusTrap";
import { T } from "../../i18n/T";
import { translateCurrent } from "../../i18n/core";
import { useI18n } from "../../i18n/useI18n";
import type { Difficulty, LandTheme } from "../../game/models/types";

const SECTIONS: GolfopediaSection[] = ["Terrain", "Golfers", "Management", "Controls"];

export function GolfopediaModal(props: {
  open: boolean;
  onClose: () => void;
  initialEntry?: string | null;
  theme?: LandTheme;
  difficulty?: Difficulty;
}) {
  const { t } = useI18n();
  const entries = useMemo(
    () => buildGolfopediaEntries(t, props.theme, props.difficulty),
    [props.difficulty, props.theme, t],
  );
  const initial = entries.find((entry) => entry.id === props.initialEntry);
  const [section, setSection] = useState<GolfopediaSection>(initial?.section ?? "Terrain");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(initial?.id ?? entries[0].id);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const trapRef = useFocusTrap<HTMLDivElement>(props.open, props.onClose);
  const bindings = loadAppProfile().accessibility.keybindings;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((entry) => (!q ? entry.section === section : `${entry.title} ${entry.summary} ${entry.details.join(" ")}`.toLowerCase().includes(q)));
  }, [entries, query, section]);
  const selectedCandidate = entries.find((entry) => entry.id === selectedId);
  const selected = (selectedCandidate && filtered.some((entry) => entry.id === selectedCandidate.id) ? selectedCandidate : filtered[0]) ?? entries[0];

  useEffect(() => {
    if (!props.open) return;
    searchRef.current?.focus();
  }, [props.open]);

  if (!props.open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={translateCurrent("auto.ui.help.golfopediamodal.golfopedia")} style={{ position: "fixed", inset: 0, zIndex: 99980, display: "grid", placeItems: "center", padding: 18, background: "rgba(19,28,20,.68)" }} onClick={props.onClose}>
      <div ref={trapRef} style={{ width: "min(980px, 100%)", height: "min(720px, 92vh)", display: "flex", flexDirection: "column", overflow: "hidden", borderRadius: 18, border: "2px solid #3d4a3e", background: "#f7f0dd", boxShadow: "0 28px 80px rgba(0,0,0,.4)" }} onClick={(event) => event.stopPropagation()}>
        <header style={{ padding: 18, borderBottom: "1px solid rgba(61,74,62,.25)", background: "#e8dcc0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
            <div><div style={{ fontFamily: "var(--font-heading)", fontWeight: 900, fontSize: 25, color: "#344338" }}><T id="auto.ui.help.golfopediamodal.golfopedia" /></div><div style={{ color: "#6b755f", fontSize: 12 }}><T id="auto.ui.help.golfopediamodal.the.course.designer.s.pocket.reference" /></div></div>
            <button onClick={props.onClose} aria-label={translateCurrent("auto.ui.help.golfopediamodal.close.golfopedia")} style={{ border: "1px solid #687266", borderRadius: 8, background: "#fffaf0", padding: "8px 11px", cursor: "pointer", fontWeight: 900 }}>✕</button>
          </div>
          <div style={{ display: "grid", gap: 10, minWidth: 0 }}>
            <div style={{ maxWidth: "100%", overflowX: "auto", paddingBottom: 2 }}>
              <GameTabs tabs={SECTIONS} activeTab={section} onTabChange={(tab) => {
                const nextSection = tab as GolfopediaSection;
                setSection(nextSection);
                setQuery("");
                setSelectedId(entries.find((entry) => entry.section === nextSection)?.id ?? entries[0].id);
              }} />
            </div>
            <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={translateCurrent("auto.ui.help.golfopediamodal.search.terrain.stats.controls")} aria-label={translateCurrent("auto.ui.help.golfopediamodal.search.golfopedia")} style={{ width: "100%", minWidth: 0, boxSizing: "border-box", borderRadius: 999, border: "1px solid rgba(61,74,62,.35)", padding: "11px 15px", background: "#fffdf6" }} />
          </div>
        </header>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(190px, 30%) 1fr", minHeight: 0, flex: 1 }}>
          <nav style={{ overflowY: "auto", borderRight: "1px solid rgba(61,74,62,.2)", padding: 10 }}>
            {filtered.map((entry) => <button key={entry.id} onClick={() => setSelectedId(entry.id)} style={{ display: "block", width: "100%", textAlign: "left", border: 0, borderRadius: 9, padding: "10px 11px", marginBottom: 4, background: selected.id === entry.id ? "#3d4a3e" : "transparent", color: selected.id === entry.id ? "white" : "#3d4a3e", cursor: "pointer", fontWeight: 800 }}>{entry.title}</button>)}
            {filtered.length === 0 && <div style={{ padding: 12, color: "#6b7280", fontSize: 13 }}><T id="auto.ui.help.golfopediamodal.no.entries.match.that.search" /></div>}
          </nav>
          <article data-testid="golfopedia-entry" data-entry-id={selected.id} style={{ overflowY: "auto", padding: "clamp(20px, 4vw, 42px)", color: "#354039" }}>
            <div style={{ textTransform: "uppercase", letterSpacing: ".12em", fontSize: 10, fontWeight: 900, color: "#8a6d3b" }}>{selected.section}</div>
            <h2 style={{ fontFamily: "var(--font-heading)", fontSize: 30, margin: "6px 0 10px" }}>{selected.title}</h2>
            <p style={{ fontSize: 16, lineHeight: 1.5, color: "#526056" }}>{selected.summary}</p>
            {selected.facts && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, margin: "20px 0" }}>{selected.facts.map((fact) => <div key={fact.label} style={{ background: "#fffaf0", border: "1px solid rgba(61,74,62,.18)", borderRadius: 10, padding: 12 }}><div style={{ fontSize: 10, letterSpacing: ".08em", color: "#778077", textTransform: "uppercase" }}>{fact.label}</div><div style={{ fontWeight: 900, marginTop: 3 }}>{fact.value}</div></div>)}</div>}
            {selected.section === "Controls" && <dl data-testid="current-keybindings" style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "6px 18px", background: "#fffaf0", padding: 14, borderRadius: 10 }}>
              {BINDING_ACTIONS.map((action) => <div key={action} style={{ display: "contents" }}>
                <dt>{t(BINDING_LABEL_KEYS[action])}</dt><dd style={{ margin: 0, fontWeight: 900 }}>{displayBinding(bindings[action])}</dd>
              </div>)}
            </dl>}
            <ul style={{ paddingLeft: 20, lineHeight: 1.65 }}>{selected.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
          </article>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { GameTabs } from "../gameui";
import { IconUi } from "../../assets/icons/IconUi";
import "./GolfopediaModal.css";
import { buildGolfopediaEntries, type GolfopediaSection } from "./golfopediaData";
import { BINDING_ACTIONS, BINDING_LABEL_KEYS, displayBinding } from "../../accessibility/keybindings";
import { loadAppProfile } from "../../game/onboarding/profile";
import { useFocusTrap } from "../accessibility/useFocusTrap";
import { T } from "../../i18n/T";
import { useI18n } from "../../i18n/useI18n";
import type { EconomicPressure, LandTheme } from "../../game/models/types";

const SECTIONS: GolfopediaSection[] = ["Terrain", "Golfers", "Management", "Controls"];
const SECTION_KEYS = {
  Terrain: "golfopedia.section.terrain",
  Golfers: "golfopedia.section.golfers",
  Management: "golfopedia.section.management",
  Controls: "golfopedia.section.controls",
} as const;

export function GolfopediaModal(props: {
  open: boolean;
  onClose: () => void;
  initialEntry?: string | null;
  theme?: LandTheme;
  economicPressure?: EconomicPressure;
}) {
  const { t } = useI18n();
  const sectionLabels = SECTIONS.map((item) => t(SECTION_KEYS[item]));
  const tabsId = `${useId()}-golfopedia-tabs`;
  const panelId = `${tabsId}-panel`;
  const entries = useMemo(
    () => buildGolfopediaEntries(t, props.theme, props.economicPressure),
    [props.economicPressure, props.theme, t],
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
    <div className="cc-golfopedia-overlay" role="dialog" aria-modal="true" aria-label={t("auto.ui.help.golfopediamodal.golfopedia")} onClick={props.onClose}>
      <div ref={trapRef} className="cc-golfopedia-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <div className="cc-golfopedia-heading">
            <div><div className="cc-golfopedia-title"><T id="auto.ui.help.golfopediamodal.golfopedia" /></div><div className="cc-golfopedia-subtitle"><T id="auto.ui.help.golfopediamodal.the.course.designer.s.pocket.reference" /></div></div>
            <button className="cc-golfopedia-close" type="button" onClick={props.onClose} aria-label={t("auto.ui.help.golfopediamodal.close.golfopedia")}><IconUi name="close" /></button>
          </div>
          <div style={{ display: "grid", gap: 10, minWidth: 0 }}>
            <div data-golfopedia-tabs data-tooltip-skip>
              <GameTabs id={tabsId} panelId={panelId} tabs={sectionLabels} activeTab={t(SECTION_KEYS[section])} onTabChange={(tab) => {
                const nextSection = SECTIONS[sectionLabels.indexOf(tab)];
                setSection(nextSection);
                setQuery("");
                setSelectedId(entries.find((entry) => entry.section === nextSection)?.id ?? entries[0].id);
              }} />
            </div>
            <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("auto.ui.help.golfopediamodal.search.terrain.stats.controls")} aria-label={t("auto.ui.help.golfopediamodal.search.golfopedia")} className="cc-golfopedia-search" />
          </div>
        </header>
        <div id={panelId} role="tabpanel" aria-labelledby={`${tabsId}-tab-${SECTIONS.indexOf(section)}`} className="cc-golfopedia-panel">
          <nav data-tooltip-skip>
            {filtered.map((entry) => <button data-golfopedia-sidebar-entry key={entry.id} aria-current={selected.id === entry.id ? "page" : undefined} onClick={() => setSelectedId(entry.id)} style={{ display: "block", width: "100%", textAlign: "left", border: 0, borderRadius: 9, padding: "10px 11px", marginBottom: 4, background: selected.id === entry.id ? "#3d4a3e" : "transparent", color: selected.id === entry.id ? "white" : "#3d4a3e", cursor: "pointer", fontWeight: 800 }}>{entry.title}</button>)}
            {filtered.length === 0 && <div className="cc-golfopedia-no-results" role="status"><T id="auto.ui.help.golfopediamodal.no.entries.match.that.search" /></div>}
          </nav>
          <article data-testid="golfopedia-entry" data-entry-id={selected.id} tabIndex={0} className="cc-golfopedia-entry">
            <div style={{ textTransform: "uppercase", letterSpacing: ".12em", fontSize: ".625rem", fontWeight: 900, color: "#8a6d3b" }}>{t(SECTION_KEYS[selected.section])}</div>
            <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "1.875rem", margin: "6px 0 10px" }}>{selected.title}</h2>
            <p style={{ fontSize: "1rem", lineHeight: 1.5, color: "#526056" }}>{selected.summary}</p>
            {selected.facts && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(7.5rem, 100%), 1fr))", gap: 8, margin: "20px 0" }}>{selected.facts.map((fact) => <div key={fact.label} style={{ background: "#fffaf0", border: "1px solid rgba(61,74,62,.18)", borderRadius: 10, padding: 12 }}><div style={{ fontSize: ".625rem", letterSpacing: ".08em", color: "#778077", textTransform: "uppercase" }}>{fact.label}</div><div style={{ fontWeight: 900, marginTop: 3 }}>{fact.value}</div></div>)}</div>}
            {selected.section === "Controls" && <dl data-testid="current-keybindings" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, auto)", gap: "6px 18px", background: "#fffaf0", padding: 14, borderRadius: 10 }}>
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

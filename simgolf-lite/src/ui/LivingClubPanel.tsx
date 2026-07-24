import { useMemo, useState } from "react";
import type { Course, StaffRole, World } from "../game/models/types";
import type { AppProfile } from "../game/onboarding/profile";
import { STORY_DEFINITION_BY_ID } from "../game/livingClub/content";
import { livingPersonName, normalizeLivingClub, normalizeStaffCharacter, type StaffCommand } from "../game/livingClub/livingClub";
import type { StoryEventInstance } from "../game/livingClub/types";
import { useI18n } from "../i18n/useI18n";
import type { MessageKey } from "../i18n/catalog";

type Tab = "people" | "staff" | "stories";

function Portrait(props: { name: string; palette: number; accent: number; staff?: boolean }) {
  const colors = ["#6f8a58", "#a66e45", "#617fa3", "#986f91", "#9b8b4f", "#4f8d86"];
  return <div aria-hidden="true" style={{ width: 42, height: 42, borderRadius: "50%", display: "grid", placeItems: "center", color: "white", fontWeight: 900, background: `linear-gradient(145deg,${colors[props.palette % colors.length]},${colors[props.accent % colors.length]})`, border: "3px solid #f3ddb2" }}>{props.staff ? "♟" : props.name.slice(0, 1).toUpperCase()}</div>;
}

function PendingStory(props: {
  world: World;
  instance: StoryEventInstance;
  onChoose: (instanceId: string, choiceId: string) => void;
  onDefer: (instanceId: string) => void;
}) {
  const { t } = useI18n();
  const definition = STORY_DEFINITION_BY_ID.get(props.instance.definitionId);
  if (!definition) return null;
  return <article data-testid="story-choice-card" style={{ border: `2px solid ${definition.priority === "major" ? "#a24b35" : "#9c8354"}`, borderRadius: 12, background: "#fffaf0", padding: 13 }}>
    <small>{t(`story.priority.${definition.priority}` as MessageKey)} · {t(`story.category.${definition.category}` as MessageKey)}</small>
    <h3 style={{ margin: "4px 0" }}>{t(definition.titleKey as MessageKey)}</h3>
    <p>{t(definition.bodyKey as MessageKey)}</p>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 9 }}>{props.instance.participantIds.map((id) => <span key={id} style={{ borderRadius: 20, padding: "4px 8px", background: "#e8ddc7" }}>👤 {livingPersonName(props.world, id)}</span>)}</div>
    <dl style={{ fontSize: 12, display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 8px" }}>{Object.entries(props.instance.facts.facts).flatMap(([key, value]) => [
      <dt key={`${key}-dt`}>{t(`story.fact.${key}` as MessageKey)}</dt>,
      <dd key={`${key}-dd`} style={{ margin: 0 }}>{Math.round((value ?? 0) * 10) / 10}</dd>,
    ])}</dl>
    <div style={{ display: "grid", gap: 7 }}>{definition.choices.map((choice) => <button key={choice.id} data-testid={`story-choice-${choice.id}`} onClick={() => props.onChoose(props.instance.id, choice.id)} style={{ textAlign: "left", padding: 9 }}>
      <strong>{t(choice.labelKey as MessageKey)}</strong><small style={{ display: "block" }}>{t(choice.previewKey as MessageKey)} {choice.uncertain ? t("story.uncertain") : t("story.known")}</small>
    </button>)}</div>
    <button onClick={() => props.onDefer(props.instance.id)} style={{ marginTop: 7 }}>{t("story.defer")}</button>
  </article>;
}

export function LivingClubPanel(props: {
  course: Course;
  world: World;
  profile: AppProfile;
  activeGolferPersonIds: Array<{ id: number; personId?: string }>;
  onProfile: (profile: AppProfile) => void;
  onFollow: (golferId: number) => void;
  onStaffCommand: (command: StaffCommand) => string | null;
  onChooseStory: (instanceId: string, choiceId: string) => void;
  onDeferStory: (instanceId: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const living = normalizeLivingClub(props.world.livingClub);
  const staff = (props.world.staffRoster ?? []).map((item, index) => normalizeStaffCharacter(item, index, props.world.week));
  const unresolved = living.story.instances.filter((instance) => ["pending", "presented", "deferred"].includes(instance.status));
  const [tab, setTab] = useState<Tab>(unresolved.length ? "stories" : "people");
  const [selectedId, setSelectedId] = useState(living.regulars[0]?.id ?? "");
  const [staffMessage, setStaffMessage] = useState("");
  const selected = living.regulars.find((regular) => regular.id === selectedId) ?? living.regulars[0];
  const activeMap = useMemo(() => new Map(props.activeGolferPersonIds.filter((item) => item.personId).map((item) => [item.personId!, item.id])), [props.activeGolferPersonIds]);
  const toggleFavorite = (id: string) => {
    const favorite = props.profile.favoritePersonIds.includes(id);
    props.onProfile({ ...props.profile, favoritePersonIds: favorite ? props.profile.favoritePersonIds.filter((item) => item !== id) : [...props.profile.favoritePersonIds, id].slice(-100) });
  };
  const run = (command: StaffCommand) => {
    const reason = props.onStaffCommand(command);
    setStaffMessage(reason ? t(`staff.command.error.${reason}` as MessageKey) : t("staff.command.done"));
  };
  return <div role="dialog" aria-modal="true" aria-labelledby="living-club-title" data-testid="living-club-panel" style={{ position: "fixed", inset: 0, zIndex: 100050, display: "grid", placeItems: "center", background: "rgba(18,25,20,.7)", padding: 16 }} onClick={props.onClose}>
    <section className="cc-tycoon-panel" style={{ width: "min(980px,100%)", maxHeight: "92vh", overflow: "hidden", display: "grid", gridTemplateRows: "auto auto minmax(0,1fr)", background: "#f3ead8", border: "3px solid #806946", borderRadius: 18 }} onClick={(event) => event.stopPropagation()}>
      <header style={{ padding: 16, background: "#3d4a3e", color: "white", display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div><div id="living-club-title" style={{ fontSize: 23, fontWeight: 900 }}>{t("livingClub.title")}</div><small>{t("livingClub.subtitle")}</small></div>
        <button aria-label={t("common.close")} onClick={props.onClose}>✕</button>
      </header>
      <nav aria-label={t("livingClub.tabs")} style={{ display: "flex", gap: 6, overflowX: "auto", padding: 10, borderBottom: "1px solid #b9aa91" }}>{(["people", "staff", "stories"] as Tab[]).map((item) => <button key={item} aria-pressed={tab === item} onClick={() => setTab(item)}>{t(`livingClub.tab.${item}` as MessageKey)}{item === "stories" && unresolved.length ? ` · ${unresolved.length}` : ""}</button>)}</nav>
      <div style={{ minHeight: 0, overflow: "auto", padding: 16 }}>
        {tab === "people" && <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,.8fr) minmax(320px,1.4fr)", gap: 14 }}>
          <div style={{ display: "grid", alignContent: "start", gap: 7 }}>{living.regulars.length ? living.regulars.map((regular) => <button key={regular.id} data-testid={`regular-${regular.id}`} onClick={() => setSelectedId(regular.id)} style={{ display: "grid", gridTemplateColumns: "44px 1fr auto", gap: 9, textAlign: "left", alignItems: "center", background: regular.id === selected?.id ? "#deead8" : "#fffdf6" }}>
            <Portrait name={regular.name} palette={regular.appearance.palette} accent={regular.appearance.accent}/>
            <span><strong>{regular.name}</strong><small style={{ display: "block" }}>{regular.relationship.tier} · {regular.rounds} {t("livingClub.rounds")}</small></span>
            <span>{props.profile.favoritePersonIds.includes(regular.id) ? "★" : ""}</span>
          </button>) : <p>{t("livingClub.people.empty")}</p>}</div>
          {selected && <article style={{ background: "#fffdf6", border: "1px solid #b9aa91", borderRadius: 12, padding: 14 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}><Portrait name={selected.name} palette={selected.appearance.palette} accent={selected.appearance.accent}/><div><h3 style={{ margin: 0 }}>{selected.name}</h3><small>{selected.archetype} · {t("livingClub.loyalty", { value: Math.round(selected.loyalty) })}</small></div></div>
            <p>{t("livingClub.person.summary", { course: selected.favoriteCourseId ?? "—", hole: selected.favoriteHoleId ?? "—", score: selected.bestToPar > 0 ? `+${selected.bestToPar}` : selected.bestToPar })}</p>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              <button data-testid="favorite-regular" onClick={() => toggleFavorite(selected.id)}>{props.profile.favoritePersonIds.includes(selected.id) ? t("livingClub.unfavorite") : t("livingClub.favorite")}</button>
              <button disabled={!activeMap.has(selected.id)} onClick={() => { const liveId = activeMap.get(selected.id); if (liveId != null) props.onFollow(liveId); }}>{activeMap.has(selected.id) ? t("livingClub.follow") : t("livingClub.offCourse")}</button>
            </div>
            <h4>{t("livingClub.relationship")}</h4><progress max={100} value={Math.max(0, selected.relationship.score + 50)} style={{ width: "100%" }}/><small>{selected.relationship.tier} · {selected.relationship.score > 0 ? "+" : ""}{selected.relationship.score}</small>
            <h4>{t("livingClub.memories")}</h4><div style={{ display: "grid", gap: 6 }}>{selected.memories.slice().reverse().map((memory) => <div key={memory.id} style={{ borderLeft: "3px solid #b89052", paddingLeft: 8 }}><b>{t(`livingClub.memory.${memory.kind}` as MessageKey)}</b><small style={{ display: "block" }}>{memory.summary.startsWith("story.") ? t(memory.summary as MessageKey) : memory.summary}</small></div>)}</div>
            <h4>{t("livingClub.history")}</h4><div style={{ display: "grid", gap: 4 }}>{selected.history.slice().reverse().map((visit) => <div key={visit.id} style={{ display: "flex", justifyContent: "space-between" }}><span>{t("livingClub.weekDay", { week: visit.week, day: visit.day + 1 })} · {visit.courseName}</span><b>{visit.scoreToPar > 0 ? "+" : ""}{visit.scoreToPar}</b></div>)}</div>
          </article>}
        </div>}

        {tab === "staff" && <div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 10 }}>
            <label>{t("staff.hire")}<select id="staff-hire-role" defaultValue="groundskeeper">{(["groundskeeper", "marshal", "club_pro", "food_service"] as StaffRole[]).map((role) => <option key={role}>{role}</option>)}</select></label>
            <button onClick={() => run({ type: "hire", role: (document.getElementById("staff-hire-role") as HTMLSelectElement)?.value as StaffRole, courseId: props.course.activeCourseId })}>{t("staff.hireCost")}</button>
            {staffMessage && <span role="status">{staffMessage}</span>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 10 }}>{staff.map((member) => <article key={member.id} data-testid={`staff-${member.id}`} style={{ background: "#fffdf6", border: "1px solid #b9aa91", borderRadius: 12, padding: 12 }}>
            <div style={{ display: "flex", gap: 9, alignItems: "center" }}><Portrait staff name={member.name} palette={member.appearance?.palette ?? 0} accent={member.appearance?.accent ?? 1}/><div><strong>{member.name}</strong><small style={{ display: "block" }}>{member.role} · {t("staff.tenure", { week: member.tenureStartWeek ?? 1 })}</small></div></div>
            <p>{member.traits?.map((trait) => t(`staff.trait.${trait}` as MessageKey)).join(" · ")}</p>
            <label>{t("staff.proficiency")}<progress max={100} value={member.proficiency ?? 50}/></label>
            <label>{t("staff.morale")}<progress max={100} value={member.morale ?? 70}/></label>
            <p>{t("staff.wage", { amount: member.weeklyWage })}</p>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}><button onClick={() => run({ type: "train", staffId: member.id })}>{t("staff.train")}</button><button onClick={() => run({ type: "compensate", staffId: member.id, raise: 50 })}>{t("staff.raise")}</button><button onClick={() => run({ type: "dismiss", staffId: member.id })}>{t("staff.dismiss")}</button></div>
          </article>)}</div>
        </div>}

        {tab === "stories" && <div style={{ display: "grid", gap: 12 }}>
          {unresolved.length ? unresolved.map((instance) => <PendingStory key={instance.id} world={props.world} instance={instance} onChoose={props.onChooseStory} onDefer={props.onDeferStory}/>) : <p>{t("story.nonePending")}</p>}
          <h3>{t("story.journal")}</h3>
          <div style={{ display: "grid", gap: 7 }}>{living.story.journal.slice().reverse().map((entry) => {
            const definition = STORY_DEFINITION_BY_ID.get(entry.definitionId);
            return <article key={entry.id} style={{ background: "#fffdf6", border: "1px solid #b9aa91", borderRadius: 10, padding: 10 }}><small>{t("story.week", { week: entry.week })}</small><strong style={{ display: "block" }}>{definition ? t(definition.titleKey as MessageKey) : entry.definitionId}</strong><span>{t(`story.choice.${entry.choiceId}` as MessageKey)} · {entry.participantIds.map((id) => livingPersonName(props.world, id)).join(", ")}</span></article>;
          })}</div>
        </div>}
      </div>
    </section>
  </div>;
}

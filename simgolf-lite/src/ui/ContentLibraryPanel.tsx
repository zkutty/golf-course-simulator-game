import { useEffect, useRef, useState } from "react";
import type { Course, World } from "../game/models/types";
import type { ContentLibraryEntry, ContentPackageKind } from "../game/contentPackages/types";
import { createCoursePackage } from "../game/contentPackages/packageFormat";
import { captureHoleTemplate, createHoleTemplatePackage } from "../game/contentPackages/holeTemplatePackage";
import { buildPackageTestRun } from "../game/scenarioAuthoring/authoring";
import {
  deleteContentPackage,
  exportContentPackage,
  importContentPackage,
  listContentLibrary,
  publishContentPackage,
  readAuthoredPackage,
  readAuthoredHoleTemplatePackage,
  readContentPackage,
  refreshWorkshopLibrary,
  saveAuthoredPackage,
  saveAuthoredHoleTemplatePackage,
} from "../game/contentPackages/library";
import { platformServices } from "../platform";
import { useI18n } from "../i18n/useI18n";

export function ContentLibraryPanel(props: {
  course: Course;
  world: World;
  onTestPlay: (testRun: { course: Course; world: World }) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [entries, setEntries] = useState<ContentLibraryEntry[]>([]);
  const [title, setTitle] = useState(props.course.name || t("content.untitled"));
  const [description, setDescription] = useState("");
  const [author, setAuthor] = useState(props.world.founderName || t("content.defaultAuthor"));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(t("content.ready"));
  const [kindFilter, setKindFilter] = useState<"all" | ContentLibraryEntry["kind"]>("all");
  const [holeId, setHoleId] = useState(props.course.holes[0]?.id ?? "");
  const isHoleTemplate = (kind: ContentPackageKind) => kind === "hole-template";

  const reload = async () => setEntries(await listContentLibrary());
  useEffect(() => {
    closeRef.current?.focus();
    void reload();
  }, []);

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    try {
      setStatus(await action());
      await reload();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("content.failed"));
    } finally {
      setBusy(false);
    }
  };

  const authorCurrent = () => run(async () => {
    const id = `author-${author.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "local"}`;
    const previous = await readAuthoredPackage(id, title.trim(), platformServices);
    const value = await createCoursePackage({
      course: props.course,
      ...(previous ? { contentId: previous.manifest.contentId, revision: previous.manifest.revision + 1, createdAt: new Date(previous.manifest.createdAt) } : {}),
      title,
      description,
      author: { id, displayName: author },
      requiredGameVersion: __APP_VERSION__,
      challenge: props.world.objectives ? {
        experienceProfile: props.world.experienceProfile ?? "classic",
        economicPressure: props.world.economicPressure ?? "balanced",
        goals: props.world.objectives.goals,
        constraints: props.world.constraints,
        allowedEventIds: [],
      } : undefined,
    });
    const saved = await saveAuthoredPackage(value);
    if (!saved.entry) throw new Error(saved.validation.status === "corrupt" || saved.validation.status === "unsupported"
      ? saved.validation.errors.join(" ")
      : t("content.failed"));
    return t("content.saved", { title: value.manifest.title });
  });

  const importFile = () => run(async () => {
    const selected = await platformServices.files.chooseImport([".coursecraft-course", ".coursecraft-hole-template", ".json"]);
    if (!selected) return t("content.importCanceled");
    const result = await importContentPackage(selected.text, "manual");
    if (!result.entry) throw new Error(result.validation.status === "corrupt" || result.validation.status === "unsupported"
      ? result.validation.errors.join(" ")
      : t("content.failed"));
    return t("content.imported", { title: result.entry.title });
  });

  const authorHole = () => run(async () => {
    const hole = props.course.holes.find((candidate) => candidate.id === holeId);
    if (!hole) throw new Error("Choose a completed hole to capture.");
    const id = `author-${author.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "local"}`;
    const previous = await readAuthoredHoleTemplatePackage(id, title.trim(), platformServices);
    const template = captureHoleTemplate(props.course, hole, {
      id: previous?.payload.template.id ?? `hole-${hole.id}`,
      title,
      description,
      yardsPerTile: 5,
      provenance: { sourceKind: "manual", sourceLabel: "Player-built hole", importedAt: new Date().toISOString(), rightsAttested: true, redistribution: "private_only", sourceAssetRetained: false },
      confidence: { scale: 1, terrain: 1, elevation: 1, notes: ["Captured from a player-built local hole."] },
    });
    const value = await createHoleTemplatePackage({
      template, title, description, author: { id, displayName: author }, requiredGameVersion: __APP_VERSION__, theme: props.course.theme ?? "parkland",
      ...(previous ? { contentId: previous.manifest.contentId, revision: previous.manifest.revision + 1, createdAt: new Date(previous.manifest.createdAt) } : {}),
    });
    const saved = await saveAuthoredHoleTemplatePackage(value);
    if (!saved.entry) throw new Error(saved.validation.status === "corrupt" || saved.validation.status === "unsupported" ? saved.validation.errors.join(" ") : t("content.failed"));
    return t("content.holeSaved", { title: value.manifest.title });
  });

  const testPlay = (entry: ContentLibraryEntry) => run(async () => {
    const value = await readContentPackage(entry.contentId);
    if (!value) throw new Error(t("content.failed"));
    props.onTestPlay(buildPackageTestRun(value, props.world, `test-${entry.contentId}-${Date.now().toString(36)}`));
    return t("content.testStarted", { title: entry.title });
  });

  const publish = (entry: ContentLibraryEntry) => run(async () => {
    const result = await publishContentPackage(entry.contentId);
    if (!result) return t("content.workshopUnavailable");
    return result.needsLegalAgreement
      ? `${t("content.legalRequired")} ${result.legalAgreementUrl ?? ""}`.trim()
      : t("content.published");
  });

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby="content-library-title"
      data-testid="content-library"
      style={{ position: "absolute", top: 54, left: 10, zIndex: 190, width: "min(620px, calc(100% - 20px))", maxHeight: "calc(100% - 126px)", overflow: "auto", borderRadius: 14, border: "2px solid #8a6826", background: "#fbf4df", color: "#253126", boxShadow: "0 14px 38px rgba(0,0,0,.36)" }}
    >
      <header style={{ position: "sticky", top: 0, zIndex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: "#334f38", color: "#fff8dc", borderBottom: "2px solid #c39a43" }}>
        <div><small>{t("content.eyebrow")}</small><h2 id="content-library-title" style={{ margin: 0 }}>{t("content.title")}</h2></div>
        <button ref={closeRef} aria-label={t("content.close")} onClick={props.onClose}>✕</button>
      </header>
      <div style={{ padding: 14, display: "grid", gap: 14 }}>
        <form onSubmit={(event) => { event.preventDefault(); void authorCurrent(); }} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <label style={{ display: "grid", gap: 4 }}>{t("content.name")}<input style={{ width: "100%", boxSizing: "border-box", padding: "7px 8px" }} value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} required /></label>
          <label style={{ display: "grid", gap: 4 }}>{t("content.author")}<input style={{ width: "100%", boxSizing: "border-box", padding: "7px 8px" }} value={author} maxLength={80} onChange={(event) => setAuthor(event.target.value)} required /></label>
          <label style={{ gridColumn: "1 / -1", display: "grid", gap: 4 }}>{t("content.description")}<textarea style={{ width: "100%", minHeight: 64, boxSizing: "border-box", padding: "7px 8px", resize: "vertical" }} value={description} maxLength={1000} onChange={(event) => setDescription(event.target.value)} /></label>
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button disabled={busy} type="submit">{t("content.saveCurrent")}</button>
            <select aria-label={t("content.captureHoleLabel")} value={holeId} onChange={(event) => setHoleId(event.target.value)} disabled={busy || props.course.holes.length === 0}>
              <option value="">{t("content.captureHolePlaceholder")}</option>
              {props.course.holes.map((hole, index) => <option key={hole.id} value={hole.id}>{t("content.holeLabel", { number: index + 1 })}</option>)}
            </select>
            <button disabled={busy || !holeId} type="button" onClick={() => void authorHole()}>{t("content.saveHoleTemplate")}</button>
            <button disabled={busy} type="button" onClick={() => void importFile()}>{t("content.import")}</button>
            <button disabled={busy || !platformServices.capabilities.workshop} type="button" onClick={() => void run(async () => {
              await refreshWorkshopLibrary();
              return t("content.refreshed");
            })}>{t("content.refresh")}</button>
          </div>
        </form>
        <p role="status" aria-live="polite" style={{ margin: 0 }}>{status}</p>
        <label style={{ display: "grid", gap: 4 }}>{t("content.filterPackages")}
          <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)}>
            <option value="all">{t("content.filterAll")}</option><option value="course">{t("content.filterCourses")}</option><option value="challenge">{t("content.filterChallenges")}</option><option value="hole-template">{t("content.filterHoleTemplates")}</option>
          </select>
        </label>
        <div style={{ display: "grid", gap: 7 }}>
          {entries.filter((entry) => kindFilter === "all" || entry.kind === kindFilter).length === 0 && <p>{t("content.empty")}</p>}
          {entries.filter((entry) => kindFilter === "all" || entry.kind === kindFilter).map((entry) => (
            <article key={entry.contentId} style={{ border: "1px solid #b7a77f", borderRadius: 9, padding: 10, background: "#fffaf0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div><strong>{entry.title}</strong><br /><small>{t("content.entrySummary", { author: entry.author, theme: entry.theme, revision: entry.revision, source: entry.source })}</small></div>
                <span>{entry.state}</span>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                {!isHoleTemplate(entry.kind) && <button disabled={busy} onClick={() => void testPlay(entry)}>{t("content.testPlay")}</button>}
                <button disabled={busy} onClick={() => void run(async () => {
                  const ok = await exportContentPackage(entry.contentId);
                  return ok ? t("content.exported") : t("content.importCanceled");
                })}>{t("content.export")}</button>
                {!isHoleTemplate(entry.kind) && <button disabled={busy || !platformServices.capabilities.workshop} onClick={() => void publish(entry)}>{t("content.publish")}</button>}
                <button disabled={busy} onClick={() => void run(async () => {
                  await deleteContentPackage(entry.contentId);
                  return t("content.deleted");
                })}>{t("content.delete")}</button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

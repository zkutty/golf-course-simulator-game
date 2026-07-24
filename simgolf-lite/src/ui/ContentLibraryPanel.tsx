import { useEffect, useRef, useState } from "react";
import type { Course, World } from "../game/models/types";
import type { ContentLibraryEntry } from "../game/contentPackages/types";
import { createCoursePackage, remapImportedCourseIdentity } from "../game/contentPackages/packageFormat";
import {
  deleteContentPackage,
  exportContentPackage,
  importContentPackage,
  listContentLibrary,
  publishContentPackage,
  readContentPackage,
  refreshWorkshopLibrary,
  saveAuthoredPackage,
} from "../game/contentPackages/library";
import { platformServices } from "../platform";
import { useI18n } from "../i18n/useI18n";

export function ContentLibraryPanel(props: {
  course: Course;
  world: World;
  onTestPlay: (course: Course) => void;
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
    const value = await createCoursePackage({
      course: props.course,
      title,
      description,
      author: { id, displayName: author },
      requiredGameVersion: __APP_VERSION__,
      challenge: props.world.objectives ? {
        difficulty: props.world.difficulty ?? "normal",
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
    const selected = await platformServices.files.chooseImport([".coursecraft-course", ".json"]);
    if (!selected) return t("content.importCanceled");
    const result = await importContentPackage(selected.text, "manual");
    if (!result.entry) throw new Error(result.validation.status === "corrupt" || result.validation.status === "unsupported"
      ? result.validation.errors.join(" ")
      : t("content.failed"));
    return t("content.imported", { title: result.entry.title });
  });

  const testPlay = (entry: ContentLibraryEntry) => run(async () => {
    const value = await readContentPackage(entry.contentId);
    if (!value) throw new Error(t("content.failed"));
    props.onTestPlay(remapImportedCourseIdentity(value, `test-${Date.now().toString(36)}`));
    return t("content.testStarted", { title: entry.title });
  });

  const publish = (entry: ContentLibraryEntry) => run(async () => {
    const result = await publishContentPackage(entry.contentId);
    if (!result) return t("content.workshopUnavailable");
    return result.needsLegalAgreement ? t("content.legalRequired") : t("content.published");
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
            <button disabled={busy} type="button" onClick={() => void importFile()}>{t("content.import")}</button>
            <button disabled={busy || !platformServices.capabilities.workshop} type="button" onClick={() => void run(async () => {
              await refreshWorkshopLibrary();
              return t("content.refreshed");
            })}>{t("content.refresh")}</button>
          </div>
        </form>
        <p role="status" aria-live="polite" style={{ margin: 0 }}>{status}</p>
        <div style={{ display: "grid", gap: 7 }}>
          {entries.length === 0 && <p>{t("content.empty")}</p>}
          {entries.map((entry) => (
            <article key={entry.contentId} style={{ border: "1px solid #b7a77f", borderRadius: 9, padding: 10, background: "#fffaf0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div><strong>{entry.title}</strong><br /><small>{t("content.entrySummary", { author: entry.author, theme: entry.theme, revision: entry.revision, source: entry.source })}</small></div>
                <span>{entry.state}</span>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                <button disabled={busy} onClick={() => void testPlay(entry)}>{t("content.testPlay")}</button>
                <button disabled={busy} onClick={() => void run(async () => {
                  const ok = await exportContentPackage(entry.contentId);
                  return ok ? t("content.exported") : t("content.importCanceled");
                })}>{t("content.export")}</button>
                <button disabled={busy || !platformServices.capabilities.workshop} onClick={() => void publish(entry)}>{t("content.publish")}</button>
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

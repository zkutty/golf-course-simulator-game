import { useEffect, useState } from "react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ContentLibraryPanel } from "../../src/ui/ContentLibraryPanel";
import { I18nContext } from "../../src/i18n/context";
import { translate } from "../../src/i18n/core";
import { DEFAULT_WORLD } from "../../src/game/models/defaults";
import { createM26MultiCourseReferenceCourse } from "../../src/game/testing/referenceCourse";
import { captureHoleTemplate, createHoleTemplatePackage } from "../../src/game/contentPackages/holeTemplatePackage";
import { saveAuthoredHoleTemplatePackage } from "../../src/game/contentPackages/library";
import { platformServices } from "../../src/platform";

const course = createM26MultiCourseReferenceCourse();
const template = captureHoleTemplate(course, course.holes[0], {
  id: "long-metadata-hole",
  title: "Long display title",
  description: "",
  yardsPerTile: 5,
  provenance: {
    sourceKind: "manual",
    sourceLabel: "Player-built-source-" + "x".repeat(110),
    importedAt: "2026-08-05T12:00:00.000Z",
    rightsAttested: true,
    redistribution: "private_only",
    sourceAssetRetained: false,
  },
  confidence: { scale: 1, terrain: 1, elevation: 1, notes: [] },
});
const value = await createHoleTemplatePackage({
  template,
  title: "A very long course title that remains readable at narrow widths " + "T".repeat(35),
  description: "",
  author: { id: "long-metadata-author", displayName: "LongAuthor" + "A".repeat(68) },
  requiredGameVersion: "1.0.0",
  theme: "parkland",
});
await saveAuthoredHoleTemplatePackage(value);
platformServices.files.chooseImport = async () => null;

export function Fixture() {
  const [open, setOpen] = useState(false);
  const [closeCount, setCloseCount] = useState(0);
  const [locale, setLocale] = useState<"en" | "pseudo">(() => localStorage.getItem("coursecraft_locale") === "pseudo" ? "pseudo" : "en");
  useEffect(() => {
    const changeLocale = () => setLocale((current) => current === "en" ? "pseudo" : "en");
    document.addEventListener("zk382-locale-change", changeLocale);
    return () => document.removeEventListener("zk382-locale-change", changeLocale);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.locale = locale;
  }, [locale]);
  const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate(locale, key, params);
  return <I18nContext.Provider value={{ locale, setLocale, t }}>
    <button data-testid="open-library" onClick={() => setOpen(true)}>Open library</button>
    <output data-testid="close-count">{closeCount}</output>
    {open && <ContentLibraryPanel course={course} world={DEFAULT_WORLD} onTestPlay={() => {}} onClose={() => {
      setCloseCount((count) => count + 1);
      setOpen(false);
    }} />}
  </I18nContext.Provider>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);

import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../../src/i18n/I18nProvider";
import { createM26MultiCourseReferenceCourse } from "../../src/game/testing/referenceCourse";
import { defaultHoleIllustrationPreviewSettings } from "../../src/game/holeIllustration/preview";
import { HoleIllustrationPreviewPanel } from "../../src/ui/HoleIllustrationPreviewPanel";
import "../../src/index.css";

export interface IllustrationFixture {
  calls: () => string[];
  close: () => void;
  reset: () => void;
}
declare global { interface Window { __illustrationFixture: IllustrationFixture } }

export function Fixture() {
  const [open, setOpen] = useState(true);
  const reference = createM26MultiCourseReferenceCourse();
  const course = { ...reference, layouts: reference.layouts?.map((layout) => ({ ...layout, publishedHoleIds: layout.publishedHoleIds.slice(0, 1) })) };
  const calls = useRef<string[]>([]);
  const settings = defaultHoleIllustrationPreviewSettings(course)!;
  useEffect(() => {
    window.__illustrationFixture = {
      calls: () => [...calls.current],
      close: () => setOpen(false),
      reset: () => { calls.current = []; setOpen(true); },
    };
  }, []);
  return <main style={{ maxWidth: 1160, margin: "0 auto", padding: 12 }}>
    {open && <HoleIllustrationPreviewPanel course={course}
      evidence={{ status: "stale-only", layoutId: settings.layoutId, holeId: settings.holeId, teeSet: settings.teeSet, pinRotation: settings.pinRotation }}
      onClose={() => { calls.current.push("close"); setOpen(false); }} />}
  </main>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider><Fixture /></I18nProvider>);

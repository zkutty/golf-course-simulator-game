import { lazy, Suspense, useLayoutEffect, useRef } from "react";
import type { Course, World } from "../game/models/types";
import { useI18n } from "../i18n/useI18n";

export type ContentLibraryPanelProps = {
  course: Course;
  world: World;
  onTestPlay: (testRun: { course: Course; world: World }) => void;
  onClose: () => void;
};

const ContentLibraryPanelContent = lazy(() => import("./ContentLibraryPanelContent").then(({ ContentLibraryPanelContent: Component }) => ({ default: Component })));

export function ContentLibraryPanel(props: ContentLibraryPanelProps) {
  const { t } = useI18n();
  const openerRef = useRef<HTMLElement | null>(null);
  const openerCapturedRef = useRef(false);
  const focusReturnFrameRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (focusReturnFrameRef.current !== null) {
      window.cancelAnimationFrame(focusReturnFrameRef.current);
      focusReturnFrameRef.current = null;
    }
    if (!openerCapturedRef.current) {
      openerRef.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null;
      openerCapturedRef.current = true;
    }
    return () => {
      const opener = openerRef.current;
      if (opener?.isConnected) {
        focusReturnFrameRef.current = window.requestAnimationFrame(() => {
          focusReturnFrameRef.current = null;
          if (opener.isConnected) opener.focus({ preventScroll: true });
        });
      }
    };
  }, []);

  return (
    <Suspense fallback={<div role="status" aria-live="polite" style={{ position: "absolute", top: 54, left: 10, zIndex: 190, padding: 14, borderRadius: 10, border: "2px solid #8a6826", background: "#fbf4df", color: "#253126" }}>{t("deferredSurface.loading", { surface: t("content.title") })}</div>}>
      <ContentLibraryPanelContent {...props} />
    </Suspense>
  );
}

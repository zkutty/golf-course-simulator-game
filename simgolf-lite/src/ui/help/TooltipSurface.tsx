import { useEffect, useId, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from "react";
import { tooltipForControl } from "./tooltipContent";

type ActiveTooltip = { content: string; left: number; top: number; placement: "above" | "below" };

function eligibleTarget(raw: EventTarget | null): HTMLElement | null {
  if (!(raw instanceof Element)) return null;
  if (raw.closest("[data-rich-tooltip]")) return null;
  return raw.closest<HTMLElement>("[data-tooltip], [title], button, input, select");
}

function labelFor(element: HTMLElement): string {
  const explicit = element.dataset.tooltip;
  if (explicit) return explicit;
  const title = element.getAttribute("title");
  if (title) return title;
  const aria = element.getAttribute("aria-label");
  if (aria) return aria;
  const label = element.closest("label")?.textContent ?? element.textContent ?? "";
  const kind = element instanceof HTMLSelectElement ? "select" : element instanceof HTMLInputElement ? "input" : "button";
  return tooltipForControl(label, kind);
}

export function TooltipSurface({ children }: { children: ReactNode }) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const describedRef = useRef<HTMLElement | null>(null);
  const [active, setActive] = useState<ActiveTooltip | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const makeStatsFocusable = () => {
      root.querySelectorAll<HTMLElement>("[data-tooltip]").forEach((element) => {
        if (!element.matches("button, input, select, textarea, a[href], [tabindex]")) element.tabIndex = 0;
      });
    };
    makeStatsFocusable();
    const observer = new MutationObserver(() => {
      makeStatsFocusable();
      if (describedRef.current && !describedRef.current.isConnected) {
        describedRef.current = null;
        setActive(null);
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const hide = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    describedRef.current?.removeAttribute("aria-describedby");
    describedRef.current = null;
    setActive(null);
  };

  const show = (element: HTMLElement) => {
    describedRef.current?.removeAttribute("aria-describedby");
    element.setAttribute("aria-describedby", id);
    describedRef.current = element;
    const rect = element.getBoundingClientRect();
    const placement = rect.top >= 90 ? "above" : "below";
    setActive({
      content: labelFor(element),
      left: Math.max(132, Math.min(window.innerWidth - 132, rect.left + rect.width / 2)),
      top: placement === "above" ? rect.top - 8 : rect.bottom + 8,
      placement,
    });
  };

  const pointerOver = (event: PointerEvent<HTMLDivElement>) => {
    const element = eligibleTarget(event.target);
    if (!element) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      if (element.matches(":hover")) show(element);
      timerRef.current = null;
    }, 500);
  };

  const focus = (event: FocusEvent<HTMLDivElement>) => {
    const element = eligibleTarget(event.target);
    if (element) show(element);
  };

  return (
    <div
      ref={rootRef}
      style={{ display: "contents" }}
      onPointerOverCapture={pointerOver}
      onPointerOutCapture={hide}
      onClickCapture={hide}
      onFocusCapture={focus}
      onBlurCapture={hide}
    >
      {children}
      {active && (
        <div
          id={id}
          role="tooltip"
          style={{
            position: "fixed",
            zIndex: 100000,
            width: 245,
            left: active.left,
            top: active.top,
            transform: active.placement === "above" ? "translate(-50%, -100%)" : "translate(-50%, 0)",
            border: "1px solid #3d4a3e",
            borderRadius: 9,
            padding: 10,
            color: "#263329",
            background: "#fffaf0",
            boxShadow: "0 8px 24px rgba(0,0,0,.2)",
            fontSize: 12,
            lineHeight: 1.35,
            pointerEvents: "none",
          }}
        >
          {active.content}
        </div>
      )}
    </div>
  );
}

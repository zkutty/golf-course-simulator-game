import { useId, useRef, useState, type FocusEvent, type ReactNode } from "react";
import { T } from "../../i18n/T";

type TooltipPosition = { left: number; top: number; placement: "above" | "below" };

export function Tooltip(props: { content: ReactNode; children: ReactNode; learnMore?: () => void; block?: boolean; label?: string }) {
  const id = useId();
  const timer = useRef<number | null>(null);
  const root = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>({ left: 132, top: 12, placement: "below" });
  const updatePosition = () => {
    const rect = root.current?.getBoundingClientRect();
    if (!rect) return;
    const placement = rect.top >= 120 ? "above" : "below";
    setPosition({
      left: Math.max(132, Math.min(window.innerWidth - 132, rect.left + rect.width / 2)),
      top: placement === "above" ? rect.top - 9 : rect.bottom + 9,
      placement,
    });
  };
  const show = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      updatePosition();
      setOpen(true);
    }, 500);
  };
  const showImmediately = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    updatePosition();
    setOpen(true);
  };
  const hide = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    setOpen(false);
  };
  const hideAfterFocusLeaves = (event: FocusEvent<HTMLSpanElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    hide();
  };
  const openLearnMore = () => {
    const stableTrigger = props.block
      ? root.current
      : root.current?.querySelector<HTMLElement>(":scope > button, :scope > a[href], :scope > input, :scope > select");
    stableTrigger?.focus();
    props.learnMore?.();
  };
  return (
    <span
      data-rich-tooltip="true"
      ref={root}
      style={{ position: "relative", display: props.block ? "block" : "inline-flex", minWidth: 0 }}
      onMouseEnter={show}
      aria-label={props.label}
      tabIndex={props.block ? 0 : undefined}
      onMouseLeave={hide}
      onFocusCapture={showImmediately}
      onBlurCapture={hideAfterFocusLeaves}
      aria-describedby={open ? id : undefined}
    >
      {props.children}
      {open && (
        <span
          id={id}
          role="tooltip"
          style={{
            position: "fixed",
            zIndex: 100000,
            width: 245,
            left: position.left,
            top: position.top,
            transform: position.placement === "above" ? "translate(-50%, -100%)" : "translate(-50%, 0)",
            border: "1px solid #3d4a3e",
            borderRadius: 9,
            padding: 10,
            color: "#263329",
            background: "#fffaf0",
            boxShadow: "0 8px 24px rgba(0,0,0,.2)",
            fontSize: 12,
            lineHeight: 1.35,
            pointerEvents: "auto",
          }}
        >
          {props.content}
          {props.learnMore && (
            <button onClick={openLearnMore} style={{ display: "block", marginTop: 6, padding: 0, border: 0, background: "none", color: "#416b46", fontWeight: 800, cursor: "pointer" }}>
              <T id="auto.ui.help.tooltip.learn.more.in.golfopedia" /></button>
          )}
        </span>
      )}
    </span>
  );
}

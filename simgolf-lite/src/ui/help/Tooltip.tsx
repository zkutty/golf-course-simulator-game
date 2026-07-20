import { useId, useRef, useState, type ReactNode } from "react";
import { T } from "../../i18n/T";

export function Tooltip(props: { content: ReactNode; children: ReactNode; learnMore?: () => void; block?: boolean }) {
  const id = useId();
  const timer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const show = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), 500);
  };
  const hide = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    setOpen(false);
  };
  return (
    <span
      data-rich-tooltip="true"
      style={{ position: "relative", display: props.block ? "block" : "inline-flex", minWidth: 0 }}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={hide}
      aria-describedby={open ? id : undefined}
    >
      {props.children}
      {open && (
        <span
          id={id}
          role="tooltip"
          style={{
            position: "absolute",
            zIndex: 100000,
            width: 245,
            left: "50%",
            bottom: "calc(100% + 9px)",
            transform: "translateX(-50%)",
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
            <button onClick={props.learnMore} style={{ display: "block", marginTop: 6, padding: 0, border: 0, background: "none", color: "#416b46", fontWeight: 800, cursor: "pointer" }}>
              <T id="auto.ui.help.tooltip.learn.more.in.golfopedia" /></button>
          )}
        </span>
      )}
    </span>
  );
}

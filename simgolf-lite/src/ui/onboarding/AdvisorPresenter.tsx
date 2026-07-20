import type { ReactNode } from "react";
import portraits from "../../assets/advisor/caddie-portraits.png";
import type { AdvisorExpression } from "../../game/advisor/advisor";
import { translateCurrent } from "../../i18n/core";

const positions: Record<AdvisorExpression, string> = {
  neutral: "0% 50%",
  pleased: "33.333% 50%",
  worried: "66.666% 50%",
  excited: "100% 50%",
};

export function AdvisorPortrait({ expression, size = 112 }: { expression: AdvisorExpression; size?: number }) {
  return (
    <div
      role="img"
      aria-label={translateCurrent("advisor.portraitLabel", { expression })}
      style={{
        width: size,
        height: size,
        flex: `0 0 ${size}px`,
        backgroundImage: `url(${portraits})`,
        backgroundSize: "400% auto",
        backgroundPosition: positions[expression],
        backgroundRepeat: "no-repeat",
        filter: "drop-shadow(0 3px 3px rgba(32, 42, 31, 0.24))",
      }}
    />
  );
}

export function AdvisorPresenter(props: {
  eyebrow?: string;
  title: string;
  body: string;
  expression: AdvisorExpression;
  actions?: ReactNode;
  compact?: boolean;
}) {
  return (
    <section
      aria-live="polite"
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-end",
        width: props.compact ? "min(430px, calc(100vw - 32px))" : "min(560px, calc(100vw - 32px))",
        color: "#263329",
      }}
    >
      <AdvisorPortrait expression={props.expression} size={props.compact ? 96 : 124} />
      <div
        style={{
          position: "relative",
          flex: 1,
          minWidth: 0,
          padding: props.compact ? 14 : 18,
          borderRadius: "16px 16px 16px 5px",
          border: "2px solid #3d4a3e",
          background: "linear-gradient(180deg, #fffdf5, #f4ead3)",
          boxShadow: "0 12px 35px rgba(22, 31, 22, 0.28), inset 0 0 0 2px rgba(255,255,255,.65)",
        }}
      >
        {props.eyebrow && (
          <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase", color: "#7a5b2f", marginBottom: 4 }}>
            {props.eyebrow}
          </div>
        )}
        <div style={{ fontFamily: "var(--font-heading)", fontWeight: 900, fontSize: props.compact ? 16 : 19, marginBottom: 5 }}>
          {props.title}
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.45, color: "#465349" }}>{props.body}</div>
        {props.actions && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>{props.actions}</div>}
      </div>
    </section>
  );
}

import type { CSSProperties, ReactNode } from "react";

export interface GameCardProps {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  variant?: "metrics" | "results" | "upgrade";
}

export function GameCard({ title, icon, children, variant = "metrics" }: GameCardProps) {
  const headerColor =
    variant === "metrics" ? "var(--cc-water)" : variant === "results" ? "var(--cc-grass)" : "var(--cc-sand)";

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.80)",
        borderRadius: 22,
        boxShadow: "0 14px 28px rgba(0,0,0,0.10)",
        overflow: "hidden",
        border: "1px solid rgba(0,0,0,0.05)",
      }}
    >
      <div
        style={{
          padding: "14px 16px",
          display: "flex",
          gap: 10,
          alignItems: "center",
          background: headerColor,
        }}
      >
        {icon && <div style={{ display: "grid", placeItems: "center" }}>{icon}</div>}
        <div style={{ fontFamily: "var(--font-heading)", fontSize: 18, fontWeight: 700, color: "#fff" }}>
          {title}
        </div>
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </div>
  );
}

export interface MetricRowProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  change?: number;
}

export function MetricRow({ label, value, icon, change }: MetricRowProps) {
  const changeStyle: CSSProperties | undefined =
    change == null
      ? undefined
      : {
          fontSize: 12,
          fontWeight: 800,
          color: change >= 0 ? "var(--cc-grass)" : "#d84848",
        };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 0",
        borderBottom: "1px solid rgba(0,0,0,0.06)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {icon && <div style={{ display: "grid", placeItems: "center" }}>{icon}</div>}
        <div style={{ fontSize: 13, fontWeight: 700, color: "#5c6a5c" }}>{label}</div>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontFamily: "var(--font-heading)", fontSize: 16, fontWeight: 800, color: "#3d4a3e" }}>
          {value}
        </div>
        {change != null && (
          <div style={changeStyle}>
            {change >= 0 ? "↑" : "↓"} {Math.abs(change)}%
          </div>
        )}
      </div>
    </div>
  );
}




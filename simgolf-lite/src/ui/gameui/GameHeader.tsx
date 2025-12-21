import type { ReactNode } from "react";
import { IconCash, IconCondition, IconReputation } from "@/assets/icons";

export interface GameHeaderProps {
  cash?: number;
  reputation?: number;
  condition?: number; // 0..1 or 0..100 accepted
  title?: string;
  subtitle?: string;
  rightSlot?: ReactNode;
}

function pct(v: number) {
  return v <= 1 ? Math.round(v * 100) : Math.round(v);
}

export function GameHeader({
  cash = 50_000,
  reputation = 85,
  condition = 0.92,
  title = "SimGolf-lite Tycoon",
  subtitle = "Build • Route • Manage",
  rightSlot,
}: GameHeaderProps) {
  return (
    <div
      style={{
        position: "relative",
        background: "var(--cc-parchment)",
        borderBottom: "4px solid rgba(92,138,78,0.18)",
        boxShadow: "0 10px 18px rgba(0,0,0,0.10)",
        overflow: "hidden",
      }}
    >
      <div style={{ position: "absolute", inset: 0, opacity: 0.05, pointerEvents: "none" }}>
        <div
          style={{
            position: "absolute",
            top: -120,
            right: -120,
            width: 260,
            height: 260,
            borderRadius: 9999,
            background: "var(--cc-forest)",
            filter: "blur(60px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -100,
            left: -100,
            width: 220,
            height: 220,
            borderRadius: 9999,
            background: "var(--cc-grass)",
            filter: "blur(60px)",
          }}
        />
      </div>

      <div
        style={{
          position: "relative",
          padding: "16px 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <div style={{ width: 48, height: 48 }}>
            {/* Flag emblem */}
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="24" cy="24" r="20" fill="var(--cc-forest)" opacity="0.2" />
              <circle cx="24" cy="24" r="18" fill="var(--cc-grass)" />
              <rect x="22" y="12" width="2" height="20" rx="1" fill="#3D4A3E" />
              <path
                d="M24 12C24 12 28 14 30 15C30 15 30 19 30 20C28 19 24 17.5 24 17.5V12Z"
                fill="#E85D5D"
              />
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                margin: 0,
                lineHeight: 1,
                fontFamily: "var(--font-heading)",
                fontSize: 26,
                fontWeight: 800,
                color: "#3D4A3E",
                letterSpacing: "-0.4px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {title}
            </div>
            <div style={{ marginTop: 4, fontSize: 13, color: "#6B7A6B" }}>{subtitle}</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <StatPill icon={<IconCash size={26} />} label="Cash" value={`$${Math.round(cash / 1000)}k`} />
            <StatPill icon={<IconReputation size={26} />} label="Reputation" value={`${Math.round(reputation)}%`} />
            <StatPill icon={<IconCondition size={26} />} label="Condition" value={`${pct(condition)}%`} />
          </div>
          {rightSlot}
        </div>
      </div>
    </div>
  );
}

function StatPill(props: { icon: ReactNode; label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        borderRadius: 999,
        background: "rgba(255,255,255,0.65)",
        border: "1px solid rgba(0,0,0,0.06)",
        boxShadow: "0 3px 10px rgba(0,0,0,0.08)",
      }}
    >
      {props.icon}
      <div>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.10em", color: "#8B9A8B" }}>
          {props.label.toUpperCase()}
        </div>
        <div style={{ fontFamily: "var(--font-heading)", fontSize: 18, fontWeight: 800, color: "#3D4A3E" }}>
          {props.value}
        </div>
      </div>
    </div>
  );
}



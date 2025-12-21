import type { CSSProperties, ReactNode } from "react";
import { IconCash, IconCondition, IconReputation } from "@/assets/icons";
import { GameButton } from "./GameButtons";

export type GameMode = "editor" | "metrics" | "results" | "upgrades";

export interface GameSidebarProps {
  currentMode: GameMode;
  onModeChange: (mode: GameMode) => void;
  onSimulate?: () => void;
  onSave?: () => void;
  onLoad?: () => void;
  onReset?: () => void;
  cash?: number;
  reputation?: number;
  condition?: number; // 0..1 or 0..100 accepted
  children?: ReactNode;
  footerRight?: ReactNode;
}

function pct(v: number) {
  return v <= 1 ? Math.round(v * 100) : Math.round(v);
}

export function GameSidebar({
  currentMode,
  onModeChange,
  onSimulate,
  onSave,
  onLoad,
  onReset,
  cash = 50_000,
  reputation = 85,
  condition = 0.92,
  children,
  footerRight,
}: GameSidebarProps) {
  const modes: { id: GameMode; label: string }[] = [
    { id: "editor", label: "Editor" },
    { id: "metrics", label: "Metrics" },
    { id: "results", label: "Results" },
    { id: "upgrades", label: "Upgrades" },
  ];

  return (
    <div
      style={{
        position: "relative",
        width: 360,
        height: "100%",
        background: "var(--cc-parchment)",
        borderLeft: "1px solid rgba(0,0,0,0.05)",
        boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.03)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ position: "absolute", inset: 0, opacity: 0.05, pointerEvents: "none" }}>
        <div
          style={{
            position: "absolute",
            top: 80,
            right: -40,
            width: 160,
            height: 160,
            borderRadius: 9999,
            background: "var(--cc-forest)",
            filter: "blur(50px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: 160,
            left: -60,
            width: 220,
            height: 220,
            borderRadius: 9999,
            background: "var(--cc-grass)",
            filter: "blur(60px)",
          }}
        />
      </div>

      <div style={{ position: "relative", flex: 1, overflow: "auto", padding: 16, display: "grid", gap: 14 }}>
        <Card title="Course Status">
          <div style={{ display: "grid", gap: 12 }}>
            <StatRow icon={<IconCash size={26} />} label="Cash" value={`$${(cash / 1000).toFixed(1)}k`} />
            <StatRow icon={<IconReputation size={26} />} label="Reputation" value={`${Math.round(reputation)}%`} />
            <StatRow icon={<IconCondition size={26} />} label="Condition" value={`${pct(condition)}%`} />
          </div>
        </Card>

        <Card title="Game Mode">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {modes.map((m) => (
              <button
                key={m.id}
                onClick={() => onModeChange(m.id)}
                style={{
                  padding: "10px 10px",
                  borderRadius: 16,
                  border: "1px solid rgba(0,0,0,0.06)",
                  background: currentMode === m.id ? "var(--cc-forest)" : "rgba(255,255,255,0.75)",
                  color: currentMode === m.id ? "#fff" : "#5c6a5c",
                  fontWeight: 800,
                  cursor: "pointer",
                  boxShadow:
                    currentMode === m.id ? "0 12px 22px rgba(0,0,0,0.14)" : "0 3px 10px rgba(0,0,0,0.08)",
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </Card>

        <GameButton variant="primary" size="lg" onClick={onSimulate} style={{ width: "100%", borderRadius: 18 }}>
          ⏩ Simulate Week
        </GameButton>

        {children}
      </div>

      <div
        style={{
          position: "relative",
          padding: 16,
          borderTop: "1px solid rgba(0,0,0,0.06)",
          display: "flex",
          gap: 10,
          alignItems: "center",
        }}
      >
        <GameButton variant="secondary" size="md" onClick={onSave} style={{ flex: 1, borderRadius: 16 }}>
          💾 Save
        </GameButton>
        <GameButton variant="secondary" size="md" onClick={onLoad} style={{ flex: 1, borderRadius: 16 }}>
          📁 Load
        </GameButton>
        {onReset && (
          <GameButton variant="secondary" size="md" onClick={onReset} style={{ borderRadius: 16 }}>
            ↺
          </GameButton>
        )}
        {footerRight}
      </div>
    </div>
  );
}

function Card(props: { title: string; children: ReactNode }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.72)",
        borderRadius: 22,
        padding: 14,
        boxShadow: "0 14px 28px rgba(0,0,0,0.10)",
        border: "1px solid rgba(0,0,0,0.05)",
      }}
    >
      <div style={{ fontFamily: "var(--font-heading)", fontSize: 16, fontWeight: 800, color: "#3D4A3E" }}>
        {props.title}
      </div>
      <div style={{ marginTop: 10 }}>{props.children}</div>
    </div>
  );
}

function StatRow(props: { icon: ReactNode; label: string; value: string }) {
  const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 800, color: "#5c6a5c" };
  const valueStyle: CSSProperties = { fontFamily: "var(--font-heading)", fontSize: 16, fontWeight: 800, color: "#3d4a3e" };

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {props.icon}
        <div style={labelStyle}>{props.label}</div>
      </div>
      <div style={valueStyle}>{props.value}</div>
    </div>
  );
}



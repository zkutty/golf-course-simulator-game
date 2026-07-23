import type { CSSProperties, ReactNode } from "react";
import { formatCurrency } from "../../i18n/format";
import { IconCash, IconCondition, IconReputation } from "@/assets/icons";
import { GameButton } from "./GameButtons";
import { T } from "../../i18n/T";
import { translateCurrent } from "../../i18n/core";

export type GameMode = "editor" | "metrics" | "results" | "upgrades";

export interface GameSidebarProps {
  currentMode: GameMode;
  onModeChange: (mode: GameMode) => void;
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
    { id: "editor", label: translateCurrent("game.mode.editor") },
    { id: "metrics", label: translateCurrent("game.mode.metrics") },
    { id: "results", label: translateCurrent("game.mode.results") },
    { id: "upgrades", label: translateCurrent("game.mode.upgrades") },
  ];

  return (
    <div
      data-gameui="sidebar"
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
        <Card title={translateCurrent("auto.ui.gameui.gamesidebar.course.status")}>
          <div style={{ display: "grid", gap: 12 }}>
            <StatRow icon={<IconCash size={26} />} label={translateCurrent("stat.cash")} value={formatCurrency(cash / 1000, "en", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "k"} />
            <StatRow icon={<IconReputation size={26} />} label={translateCurrent("stat.reputation")} value={`${Math.round(reputation)}%`} />
            <StatRow icon={<IconCondition size={26} />} label={translateCurrent("stat.condition")} value={`${pct(condition)}%`} />
          </div>
        </Card>

        <Card title={translateCurrent("auto.ui.gameui.gamesidebar.game.mode")}>
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
          <T id="auto.ui.gameui.gamesidebar.save" /></GameButton>
        <GameButton variant="secondary" size="md" onClick={onLoad} style={{ flex: 1, borderRadius: 16 }}>
          <T id="auto.ui.gameui.gamesidebar.load" /></GameButton>
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
      data-gameui="sidebar-card"
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



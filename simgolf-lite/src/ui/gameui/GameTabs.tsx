import type { CSSProperties } from "react";

export interface GameTabsProps {
  tabs: string[];
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function GameTabs({ tabs, activeTab, onTabChange }: GameTabsProps) {
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        padding: 8,
        borderRadius: 999,
        background: "rgba(255,255,255,0.45)",
        border: "1px solid rgba(0,0,0,0.05)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.4)",
      }}
    >
      {tabs.map((t) => {
        const isActive = t === activeTab;
        const btn: CSSProperties = {
          padding: "10px 14px",
          borderRadius: 999,
          border: "1px solid rgba(0,0,0,0.06)",
          background: isActive ? "var(--cc-forest)" : "transparent",
          color: isActive ? "#fff" : "#5c6a5c",
          fontSize: 13,
          fontWeight: 800,
          cursor: "pointer",
          boxShadow: isActive ? "0 10px 20px rgba(0,0,0,0.14)" : undefined,
        };
        return (
          <button key={t} onClick={() => onTabChange(t)} style={btn}>
            {t}
          </button>
        );
      })}
    </div>
  );
}

export interface PillTabsProps {
  tabs: { id: string; label: string; icon?: string }[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export function PillTabs({ tabs, activeTab, onTabChange }: PillTabsProps) {
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 6,
        padding: 6,
        borderRadius: 999,
        background: "rgba(255,255,255,0.60)",
        border: "1px solid rgba(0,0,0,0.06)",
        boxShadow: "inset 0 2px 10px rgba(0,0,0,0.08)",
      }}
    >
      {tabs.map((t) => {
        const isActive = t.id === activeTab;
        return (
          <button
            key={t.id}
            onClick={() => onTabChange(t.id)}
            style={{
              padding: "8px 12px",
              borderRadius: 999,
              border: "1px solid rgba(0,0,0,0.06)",
              background: isActive ? "var(--cc-grass)" : "transparent",
              color: isActive ? "#fff" : "#6b7a6b",
              fontSize: 13,
              fontWeight: 800,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              boxShadow: isActive ? "0 12px 22px rgba(0,0,0,0.14)" : undefined,
            }}
          >
            {t.icon && <span>{t.icon}</span>}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}




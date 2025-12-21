import { useState } from "react";
import { IconCash, IconDeepRough, IconHoles, IconSand, IconTree, IconWater } from "@/assets/icons";
import { GameBackground } from "./GameBackground";
import { GameButton, IconButton } from "./GameButtons";
import { GameCard, MetricRow } from "./GameCard";
import { GameHeader } from "./GameHeader";
import { GameSidebar } from "./GameSidebar";
import { PillTabs } from "./GameTabs";

type GameMode = "editor" | "metrics" | "results" | "upgrades";

export function GameUIDemo() {
  const [currentMode, setCurrentMode] = useState<GameMode>("metrics");
  const [activeTab, setActiveTab] = useState("terrain");

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <GameBackground />

      <GameHeader cash={52_500} reputation={87} condition={0.94} />

      <div style={{ flex: 1, display: "flex" }}>
        <GameSidebar
          currentMode={currentMode}
          onModeChange={setCurrentMode}
          onSimulate={() => alert("Simulating week...")}
          onSave={() => alert("Saved!")}
          onLoad={() => alert("Load...")}
          cash={52_500}
          reputation={87}
          condition={0.94}
        />

        <div style={{ flex: 1, overflow: "auto", padding: 18, display: "grid", gap: 18 }}>
          {currentMode === "metrics" && (
            <div style={{ maxWidth: 1100 }}>
              <h2 style={{ fontFamily: "var(--font-heading)", fontSize: 26, margin: "0 0 12px 0", color: "#3d4a3e" }}>
                Course Metrics
              </h2>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
                <GameCard title="Course Statistics" icon={<IconHoles size={26} />} variant="metrics">
                  <MetricRow label="Total holes" value="9" icon={<IconHoles size={22} />} />
                  <MetricRow label="Water hazards" value="12" icon={<IconWater size={22} />} />
                  <MetricRow label="Sand bunkers" value="34" icon={<IconSand size={22} />} />
                  <MetricRow label="Trees" value="156" icon={<IconTree size={22} />} />
                  <MetricRow label="Deep rough" value="8" icon={<IconDeepRough size={22} />} />
                </GameCard>

                <GameCard title="Financial Overview" icon={<IconCash size={26} />} variant="metrics">
                  <MetricRow label="Weekly revenue" value="$8,200" change={12} />
                  <MetricRow label="Maintenance cost" value="$2,400" change={-5} />
                  <MetricRow label="Net profit" value="$5,800" change={18} />
                  <MetricRow label="Visitors/week" value="342" change={8} />
                </GameCard>
              </div>
            </div>
          )}

          {currentMode === "results" && (
            <div style={{ maxWidth: 1100 }}>
              <h2 style={{ fontFamily: "var(--font-heading)", fontSize: 26, margin: "0 0 12px 0", color: "#3d4a3e" }}>
                Weekly Results
              </h2>
              <GameCard title="Week 24 Summary" icon={<span style={{ fontSize: 22 }}>📊</span>} variant="results">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                  <SummaryTile label="Visitors" value="342" delta="+8%" />
                  <SummaryTile label="Revenue" value="$8.2k" delta="+12%" />
                  <SummaryTile label="Rating" value="4.7" delta="+0.2" />
                </div>
              </GameCard>
            </div>
          )}

          {currentMode === "upgrades" && (
            <div style={{ maxWidth: 1100 }}>
              <h2 style={{ fontFamily: "var(--font-heading)", fontSize: 26, margin: "0 0 12px 0", color: "#3d4a3e" }}>
                Course Upgrades
              </h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14 }}>
                <UpgradeCard title="Irrigation System" desc="Improve grass condition and reduce maintenance costs." cost="$12,000" />
                <UpgradeCard title="Clubhouse Upgrade" desc="Increase visitor capacity and reputation." cost="$25,000" />
                <UpgradeCard title="Pro Shop" desc="Generate additional revenue from equipment sales." cost="$8,500" />
              </div>
            </div>
          )}

          {currentMode === "editor" && (
            <div style={{ maxWidth: 1100 }}>
              <h2 style={{ fontFamily: "var(--font-heading)", fontSize: 26, margin: "0 0 12px 0", color: "#3d4a3e" }}>
                Course Editor
              </h2>

              <div style={{ marginBottom: 12 }}>
                <PillTabs
                  tabs={[
                    { id: "terrain", label: "Terrain", icon: "🏞️" },
                    { id: "hazards", label: "Hazards", icon: "⚠️" },
                    { id: "features", label: "Features", icon: "🌳" },
                  ]}
                  activeTab={activeTab}
                  onTabChange={setActiveTab}
                />
              </div>

              <div style={{ background: "rgba(255,255,255,0.72)", borderRadius: 22, padding: 16, boxShadow: "0 14px 28px rgba(0,0,0,0.10)" }}>
                <div style={{ fontFamily: "var(--font-heading)", fontSize: 18, fontWeight: 800, color: "#3d4a3e" }}>
                  Editor Tools
                </div>
                <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 10 }}>
                  <IconButton icon={<IconHoles size={30} />} label="Place Hole" />
                  <IconButton icon={<IconWater size={30} />} label="Water" />
                  <IconButton icon={<IconSand size={30} />} label="Bunker" />
                  <IconButton icon={<IconTree size={30} />} label="Tree" />
                  <IconButton icon={<IconDeepRough size={30} />} label="Rough" />
                  <IconButton icon={<span style={{ fontSize: 24 }}>🏌️</span>} label="Tee Box" disabled />
                </div>
              </div>

              <div style={{ marginTop: 12, background: "rgba(255,255,255,0.72)", borderRadius: 22, padding: 16, boxShadow: "0 14px 28px rgba(0,0,0,0.10)" }}>
                <div style={{ fontFamily: "var(--font-heading)", fontSize: 18, fontWeight: 800, color: "#3d4a3e" }}>
                  Actions
                </div>
                <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 10 }}>
                  <GameButton variant="primary">Save Changes</GameButton>
                  <GameButton variant="secondary">Cancel</GameButton>
                  <GameButton variant="success" icon={<span>✓</span>}>
                    Apply
                  </GameButton>
                  <GameButton variant="danger" icon={<span>🗑️</span>}>
                    Clear All
                  </GameButton>
                  <GameButton variant="primary" disabled>
                    Disabled
                  </GameButton>
                </div>
              </div>
            </div>
          )}

          <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
            Demo-only screen. Integration into the real game comes next.
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryTile(props: { label: string; value: string; delta: string }) {
  return (
    <div style={{ background: "rgba(249,245,238,0.9)", borderRadius: 16, padding: 12, textAlign: "center" }}>
      <div style={{ color: "#8B9A8B", fontSize: 12, fontWeight: 700 }}>{props.label}</div>
      <div style={{ fontFamily: "var(--font-heading)", fontSize: 22, fontWeight: 800, color: "#3d4a3e", marginTop: 4 }}>
        {props.value}
      </div>
      <div style={{ color: "var(--cc-grass)", fontSize: 12, fontWeight: 800, marginTop: 4 }}>{props.delta}</div>
    </div>
  );
}

function UpgradeCard(props: { title: string; desc: string; cost: string }) {
  return (
    <GameCard title={props.title} icon={<span style={{ fontSize: 22 }}>🏛️</span>} variant="upgrade">
      <div style={{ color: "#6B7A6B", fontSize: 13, marginBottom: 12 }}>{props.desc}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ color: "#8B9A8B", fontSize: 12, fontWeight: 700 }}>Cost</div>
        <div style={{ fontFamily: "var(--font-heading)", fontSize: 16, fontWeight: 800, color: "#3d4a3e" }}>{props.cost}</div>
      </div>
      <GameButton variant="success" size="sm" style={{ width: "100%" }}>
        Purchase
      </GameButton>
    </GameCard>
  );
}



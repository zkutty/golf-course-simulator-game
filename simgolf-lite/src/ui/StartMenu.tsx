import { useMemo, useState } from "react";
import { MenuButton } from "./MenuButton";
import { StartMenuBackground } from "./StartMenuBackground";

export interface StartMenuProps {
  canLoad: boolean;
  onNewGame: () => void;
  onLoadGame: () => void;
}

export function StartMenu(props: StartMenuProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const loadSubtitle = useMemo(() => (props.canLoad ? undefined : "No saved game"), [props.canLoad]);

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden" }}>
      <StartMenuBackground />

      <div style={{ position: "relative", zIndex: 10, height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: "min(720px, 100%)", padding: 24 }}>
          {/* Decorative emblem */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 26 }}>
            <div style={{ position: "relative" }}>
              <div
                style={{
                  borderRadius: 26,
                  padding: 18,
                  boxShadow: "0 28px 60px rgba(0,0,0,0.28)",
                  background: "linear-gradient(135deg, #F5EFE6 0%, #EBE3D5 50%, #E0D5C3 100%)",
                  border: "3px solid #C4B5A0",
                }}
              >
                <div
                  style={{
                    position: "relative",
                    overflow: "hidden",
                    width: 220,
                    height: 132,
                    borderRadius: "50%",
                    border: "3px solid #8B7355",
                    background: "linear-gradient(to bottom, #B8D8E8 0%, #C8E0C8 50%, #7AB86D 100%)",
                  }}
                >
                  <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, #B8D8E8 0%, #C8E0C8 60%)" }} />
                  <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice">
                    <ellipse cx="50" cy="75" rx="45" ry="25" fill="#9BC5A8" opacity="0.7" />
                    <ellipse cx="160" cy="70" rx="50" ry="28" fill="#9BC5A8" opacity="0.7" />
                    <path d="M0 80 Q50 65 100 75 T200 70 L200 120 L0 120 Z" fill="#7AB86D" />
                    <path d="M0 95 Q60 90 120 95 T200 92 L200 120 L0 120 Z" fill="#5C8A4E" />
                    <g>
                      <rect x="35" y="68" width="4" height="12" rx="1" fill="#6B5344" />
                      <ellipse cx="37" cy="65" rx="8" ry="10" fill="#4A7C3E" />
                      <ellipse cx="34" cy="63" rx="6" ry="7" fill="#5C8A4E" />
                      <ellipse cx="40" cy="64" rx="5" ry="6" fill="#5C8A4E" />
                    </g>
                    <g>
                      <rect x="155" y="65" width="3" height="10" rx="1" fill="#6B5344" />
                      <path d="M156.5 55 L163 65 L150 65 Z" fill="#3D6B3D" />
                      <path d="M156.5 60 L162 68 L151 68 Z" fill="#4A7C3E" />
                      <rect x="167" y="68" width="3" height="9" rx="1" fill="#6B5344" />
                      <path d="M168.5 60 L174 68 L163 68 Z" fill="#3D6B3D" />
                      <path d="M168.5 64 L173 71 L164 71 Z" fill="#4A7C3E" />
                    </g>
                    <line x1="100" y1="80" x2="100" y2="55" stroke="#8B7355" strokeWidth="1.5" />
                    <path d="M100 55 L115 60 L115 65 L100 62 Z" fill="#D84848" />
                    <path d="M100 55 L112 59 L112 63 L100 60 Z" fill="#E85D5D" />
                    <ellipse cx="100" cy="80" rx="2.5" ry="1.5" fill="#4A6B42" />
                  </svg>
                </div>
              </div>

              {/* Decorative corner accents */}
              {[
                { top: -8, left: -8 },
                { top: -8, right: -8 },
                { bottom: -8, left: -8 },
                { bottom: -8, right: -8 },
              ].map((p, i) => (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    width: 24,
                    height: 24,
                    borderRadius: 999,
                    background: "var(--cc-sand)",
                    opacity: 0.4,
                    ...p,
                  }}
                />
              ))}
            </div>
          </div>

          {/* Title */}
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 64,
                fontWeight: 800,
                letterSpacing: "-1px",
                color: "#fff",
                textShadow: "0 4px 12px rgba(61, 74, 62, 0.5), 0 2px 4px rgba(61, 74, 62, 0.3)",
              }}
            >
              CourseCraft
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: "2px",
                color: "#F2E8C9",
                textShadow: "0 2px 8px rgba(61, 74, 62, 0.4)",
              }}
            >
              Design and run your course
            </div>
          </div>

          {/* Buttons */}
          <div style={{ display: "grid", gap: 14, width: "min(420px, 100%)", margin: "0 auto" }}>
            <MenuButton variant="primary" icon="⛳" onClick={props.onNewGame}>
              New Game
            </MenuButton>

            <MenuButton
              variant="secondary"
              icon="📁"
              onClick={props.onLoadGame}
              disabled={!props.canLoad}
              subtitle={loadSubtitle}
            >
              Load Game
            </MenuButton>

            <MenuButton variant="secondary" icon="⚙️" onClick={() => setSettingsOpen(true)}>
              Settings
            </MenuButton>
          </div>

          <div style={{ textAlign: "center", marginTop: 26, fontSize: 12, color: "rgba(255,255,255,0.65)", textShadow: "0 1px 3px rgba(0, 0, 0, 0.3)" }}>
            v0.1 • A cozy golf management experience
          </div>
        </div>
      </div>

      {/* Settings modal (stub) */}
      {settingsOpen && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 999,
          }}
          onClick={() => setSettingsOpen(false)}
        >
          <div
            style={{
              width: "min(520px, 100%)",
              borderRadius: 18,
              background: "rgba(255,255,255,0.92)",
              border: "1px solid rgba(0,0,0,0.12)",
              boxShadow: "0 22px 55px rgba(0,0,0,0.22)",
              padding: 16,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 20, fontWeight: 800, color: "#3d4a3e" }}>
              Settings
            </div>
            <div style={{ marginTop: 8, color: "#6b7280", fontSize: 13 }}>
              Settings UI is a stub for now. Next we can add sound/animations/default view mode, etc.
            </div>
            <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => setSettingsOpen(false)}
                style={{
                  padding: "10px 14px",
                  borderRadius: 999,
                  border: "1px solid rgba(0,0,0,0.12)",
                  background: "rgba(255,255,255,0.9)",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



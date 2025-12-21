import { useState, useEffect } from "react";

export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  audioVolumes: { music: number; ambience: number };
  onAudioVolumesChange: (volumes: { music?: number; ambience?: number }) => void;
  renderer: "canvas" | "pixi";
  onRendererChange: (renderer: "canvas" | "pixi") => void;
}

export function SettingsModal(props: SettingsModalProps) {
  const [musicVolume, setMusicVolume] = useState(props.audioVolumes.music);
  const [ambienceVolume, setAmbienceVolume] = useState(props.audioVolumes.ambience);

  useEffect(() => {
    setMusicVolume(props.audioVolumes.music);
    setAmbienceVolume(props.audioVolumes.ambience);
  }, [props.audioVolumes]);

  if (!props.open) return null;

  const handleMusicChange = (value: number) => {
    setMusicVolume(value);
    props.onAudioVolumesChange({ music: value });
  };

  const handleAmbienceChange = (value: number) => {
    setAmbienceVolume(value);
    props.onAudioVolumesChange({ ambience: value });
  };

  return (
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
      onClick={props.onClose}
    >
      <div
        style={{
          width: "min(520px, 100%)",
          borderRadius: 18,
          background: "rgba(255,255,255,0.92)",
          border: "1px solid rgba(0,0,0,0.12)",
          boxShadow: "0 22px 55px rgba(0,0,0,0.22)",
          padding: 24,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontFamily: "var(--font-heading)", fontSize: 24, fontWeight: 800, color: "#3d4a3e", marginBottom: 24 }}>
          Settings
        </div>

        {/* Audio section */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 18, fontWeight: 700, color: "#3d4a3e", marginBottom: 16 }}>
            Audio
          </div>


          {/* Music volume */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <label style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 600, color: "#4b5563" }}>
                Music Volume
              </label>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "#6b7280", minWidth: 40, textAlign: "right" }}>
                {Math.round(musicVolume * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={musicVolume}
              onChange={(e) => handleMusicChange(parseFloat(e.target.value))}
              style={{
                width: "100%",
                height: 8,
                borderRadius: 4,
                background: `linear-gradient(to right, #3d4a3e 0%, #3d4a3e ${musicVolume * 100}%, #e5e7eb ${musicVolume * 100}%, #e5e7eb 100%)`,
                outline: "none",
                cursor: "pointer",
                appearance: "none",
                WebkitAppearance: "none",
              }}
            />
          </div>

          {/* Ambience volume */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <label style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 600, color: "#4b5563" }}>
                Ambience Volume
              </label>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "#6b7280", minWidth: 40, textAlign: "right" }}>
                {Math.round(ambienceVolume * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={ambienceVolume}
              onChange={(e) => handleAmbienceChange(parseFloat(e.target.value))}
              style={{
                width: "100%",
                height: 8,
                borderRadius: 4,
                background: `linear-gradient(to right, #3d4a3e 0%, #3d4a3e ${ambienceVolume * 100}%, #e5e7eb ${ambienceVolume * 100}%, #e5e7eb 100%)`,
                outline: "none",
                cursor: "pointer",
                appearance: "none",
                WebkitAppearance: "none",
              }}
            />
          </div>
        </div>

        {/* Renderer section */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 18, fontWeight: 700, color: "#3d4a3e", marginBottom: 16 }}>
            Renderer
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button
              onClick={() => props.onRendererChange("canvas")}
              style={{
                padding: "8px 16px",
                borderRadius: 6,
                border: `2px solid ${props.renderer === "canvas" ? "#3d4a3e" : "rgba(0,0,0,0.2)"}`,
                background: props.renderer === "canvas" ? "#3d4a3e" : "#fff",
                color: props.renderer === "canvas" ? "#fff" : "#3d4a3e",
                fontWeight: props.renderer === "canvas" ? 600 : 400,
                cursor: "pointer",
                fontFamily: "var(--font-body)",
                fontSize: 14,
              }}
            >
              Canvas
            </button>
            <button
              onClick={() => props.onRendererChange("pixi")}
              style={{
                padding: "8px 16px",
                borderRadius: 6,
                border: `2px solid ${props.renderer === "pixi" ? "#3d4a3e" : "rgba(0,0,0,0.2)"}`,
                background: props.renderer === "pixi" ? "#3d4a3e" : "#fff",
                color: props.renderer === "pixi" ? "#fff" : "#3d4a3e",
                fontWeight: props.renderer === "pixi" ? 600 : 400,
                cursor: "pointer",
                fontFamily: "var(--font-body)",
                fontSize: 14,
              }}
            >
              Pixi
            </button>
          </div>
        </div>

        {/* Close button */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={props.onClose}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "1px solid rgba(0,0,0,0.12)",
              background: "#3d4a3e",
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "var(--font-body)",
              fontSize: 14,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

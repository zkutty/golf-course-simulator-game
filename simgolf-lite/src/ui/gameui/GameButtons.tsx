import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

type Variant = "primary" | "secondary" | "success" | "danger";
type Size = "sm" | "md" | "lg";

export interface GameButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

export function GameButton({
  variant = "primary",
  size = "md",
  icon,
  children,
  disabled,
  style,
  ...props
}: GameButtonProps) {
  const padding =
    size === "sm" ? "8px 14px" : size === "lg" ? "14px 18px" : "10px 16px";
  const fontSize = size === "sm" ? 13 : size === "lg" ? 16 : 14;

  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 999,
    border: "1px solid rgba(0,0,0,0.06)",
    padding,
    fontSize,
    fontWeight: 800,
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "transform 120ms ease, box-shadow 120ms ease, background 120ms ease",
    userSelect: "none",
    transform: "translateZ(0)",
  };

  const variants: Record<Variant, CSSProperties> = {
    primary: disabled
      ? { background: "rgba(92,138,78,0.35)", color: "rgba(255,255,255,0.75)" }
      : {
          background: "var(--cc-forest)",
          color: "#fff",
          boxShadow: "0 10px 22px rgba(0,0,0,0.12)",
        },
    secondary: disabled
      ? { background: "rgba(255,255,255,0.35)", color: "rgba(90,100,90,0.6)" }
      : {
          background: "rgba(255,255,255,0.8)",
          color: "#4b5a4b",
          boxShadow: "0 3px 10px rgba(0,0,0,0.08)",
        },
    success: disabled
      ? { background: "rgba(139,197,115,0.35)", color: "rgba(255,255,255,0.75)" }
      : {
          background: "var(--cc-grass)",
          color: "#fff",
          boxShadow: "0 10px 22px rgba(0,0,0,0.12)",
        },
    danger: disabled
      ? { background: "rgba(216,72,72,0.35)", color: "rgba(255,255,255,0.75)" }
      : {
          background: "#d84848",
          color: "#fff",
          boxShadow: "0 10px 22px rgba(0,0,0,0.12)",
        },
  };

  return (
    <button
      disabled={disabled}
      style={{ ...base, ...variants[variant], ...style }}
      {...props}
      onMouseDown={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.98)";
        props.onMouseDown?.(e);
      }}
      onMouseUp={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
        props.onMouseUp?.(e);
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
        props.onMouseLeave?.(e);
      }}
    >
      {icon && <span style={{ display: "inline-flex", alignItems: "center" }}>{icon}</span>}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
  variant?: "primary" | "secondary";
}

export function IconButton({ icon, label, variant = "secondary", disabled, style, ...props }: IconButtonProps) {
  const base: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 16,
    border: "1px solid rgba(0,0,0,0.06)",
    background: "rgba(255,255,255,0.6)",
    boxShadow: "0 3px 10px rgba(0,0,0,0.08)",
    transition: "transform 120ms ease, box-shadow 120ms ease, background 120ms ease",
    cursor: disabled ? "not-allowed" : "pointer",
  };
  const variantStyle: CSSProperties =
    variant === "primary"
      ? { background: "rgba(92,138,78,0.18)" }
      : { background: "rgba(255,255,255,0.6)" };

  return (
    <button
      disabled={disabled}
      style={{ ...base, ...variantStyle, ...(disabled ? { opacity: 0.55 } : {}), ...style }}
      {...props}
    >
      <div style={{ display: "grid", placeItems: "center" }}>{icon}</div>
      <div style={{ fontSize: 12, fontWeight: 800, color: disabled ? "#8b9a8b" : "#3d4a3e" }}>{label}</div>
    </button>
  );
}



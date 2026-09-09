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
    primary: { background: "var(--ui-action-selected)", color: "var(--ui-action-selected-text)" },
    secondary: { background: "var(--ui-action-surface)", color: "var(--ui-action-text)" },
    success: { background: "var(--ui-action-selected)", color: "var(--ui-action-selected-text)" },
    danger: { background: "var(--ui-danger-surface)", color: "var(--ui-danger-text)" },
  };

  return (
    <button
      data-gameui="button"
      data-variant={variant}
      disabled={disabled}
      style={{ ...base, ...variants[variant], ...style }}
      {...props}
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
    background: "var(--ui-action-surface)",
    color: "var(--ui-action-text)",
    boxShadow: "0 3px 10px rgba(0,0,0,0.08)",
    transition: "transform 120ms ease, box-shadow 120ms ease, background 120ms ease",
    cursor: disabled ? "not-allowed" : "pointer",
  };
  const variantStyle: CSSProperties =
    variant === "primary"
      ? { background: "var(--ui-action-selected)", color: "var(--ui-action-selected-text)" }
      : { background: "var(--ui-action-surface)", color: "var(--ui-action-text)" };

  return (
    <button
      data-gameui="icon-button"
      disabled={disabled}
      style={{ ...base, ...variantStyle, ...(disabled ? { opacity: 0.55 } : {}), ...style }}
      {...props}
    >
      <div style={{ display: "grid", placeItems: "center" }}>{icon}</div>
      <div style={{ fontSize: 12, fontWeight: 800, color: "inherit" }}>{label}</div>
    </button>
  );
}

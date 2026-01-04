import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

export interface MenuButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "primary" | "secondary";
  icon?: ReactNode;
  subtitle?: string;
}

export function MenuButton({ children, variant = "primary", icon, subtitle, disabled, style, ...props }: MenuButtonProps) {
  const base: CSSProperties = {
    width: "100%",
    padding: "18px 22px",
    borderRadius: 22,
    border: "1px solid rgba(0,0,0,0.10)",
    fontFamily: "var(--font-body)",
    fontSize: 18,
    fontWeight: 900,
    letterSpacing: "0.3px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "transform 120ms ease, box-shadow 120ms ease, background 120ms ease, opacity 120ms ease",
    userSelect: "none",
  };

  const variants: Record<NonNullable<MenuButtonProps["variant"]>, CSSProperties> = {
    primary: disabled
      ? { background: "rgba(92,138,78,0.35)", color: "rgba(255,255,255,0.75)" }
      : { background: "var(--cc-forest)", color: "#fff", boxShadow: "0 18px 34px rgba(0,0,0,0.22)" },
    secondary: disabled
      ? { background: "rgba(255,255,255,0.55)", color: "rgba(61,74,62,0.45)" }
      : { background: "rgba(255,255,255,0.85)", color: "#3D4A3E", boxShadow: "0 14px 28px rgba(0,0,0,0.18)" },
  };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <button
        disabled={disabled}
        style={{ ...base, ...variants[variant], opacity: disabled ? 0.75 : 1, ...style }}
        {...props}
        onMouseDown={(e) => {
          if (!disabled) (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.98)";
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
        {icon && <span style={{ fontSize: 22, lineHeight: 1 }}>{icon}</span>}
        <span>{children}</span>
      </button>
      {subtitle && <div style={{ textAlign: "center", fontSize: 13, color: "rgba(255,255,255,0.75)" }}>{subtitle}</div>}
    </div>
  );
}






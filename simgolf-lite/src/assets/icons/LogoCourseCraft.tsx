export function LogoCourseCraft(props: { width?: number; height?: number; style?: React.CSSProperties }) {
  const width = props.width ?? 176;
  const height = props.height ?? 44;
  
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox="0 0 640 240"
      style={props.style}
    >
      <defs>
        <linearGradient id="logo-g" x1="0" x2="1">
          <stop offset="0" stopColor="#2f5b3b" />
          <stop offset="1" stopColor="#1f3f2a" />
        </linearGradient>
        <filter id="logo-soft" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#000" floodOpacity="0.15" />
        </filter>
      </defs>

      <rect x="0" y="0" width="640" height="240" fill="none" />

      {/* Emblem */}
      <g transform="translate(90 46)" filter="url(#logo-soft)">
        <path d="M20 68c70-70 170-70 240 0" fill="none" stroke="#b08a52" strokeWidth="8" strokeLinecap="round" />
        <ellipse cx="140" cy="84" rx="130" ry="52" fill="#f7f3ea" stroke="#d8cfbf" strokeWidth="4" />
        <path d="M34 92c42 30 170 38 214-8" fill="none" stroke="#c6b79b" strokeWidth="3" opacity="0.8" />

        {/* Hill + green */}
        <path
          d="M44 104c30-26 74-34 122-26 22 4 46 14 70 22 30 10 58 10 88-6"
          fill="none"
          stroke="#5e7e5c"
          strokeWidth="6"
          strokeLinecap="round"
          opacity="0.9"
        />
        <path d="M66 116c44 18 96 18 156 0" fill="none" stroke="#3f6b46" strokeWidth="8" strokeLinecap="round" />

        {/* Flag */}
        <g transform="translate(212 46)">
          <path d="M0 90V20" stroke="#6b4b2a" strokeWidth="6" strokeLinecap="round" />
          <path d="M2 22c28 8 34 20 0 30" fill="#c23b35" />
          <circle cx="0" cy="90" r="6" fill="#c6b79b" />
        </g>

        {/* Trees */}
        <g fill="#3f6b46" opacity="0.95">
          <circle cx="88" cy="64" r="14" />
          <circle cx="104" cy="60" r="12" />
          <circle cx="330" cy="64" r="14" />
          <circle cx="346" cy="60" r="12" />
        </g>
      </g>

      {/* Wordmark */}
      <g transform="translate(320 118)">
        <text x="0" y="0" fontFamily="Georgia, serif" fontSize="64" fontWeight="700" fill="url(#logo-g)">
          CourseCraft
        </text>
        <text x="4" y="42" fontFamily="system-ui, -apple-system, Segoe UI, sans-serif" fontSize="18" letterSpacing="3" fill="#6b7a5f">
          DESIGN & RUN YOUR COURSE
        </text>
      </g>
    </svg>
  );
}



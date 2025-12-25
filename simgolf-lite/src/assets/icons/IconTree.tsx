interface IconProps {
  size?: number;
  className?: string;
}

export function IconTree({ size = 64, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Tree shadow */}
      <ellipse cx="32" cy="52" rx="12" ry="4" fill="#5C8A4E" opacity="0.3" />

      {/* Trunk */}
      <rect x="28" y="36" width="8" height="18" rx="2" fill="#8B7355" />
      <rect x="29" y="36" width="6" height="18" rx="1.5" fill="#A08568" />

      {/* Back canopy layer */}
      <circle cx="32" cy="26" r="16" fill="#6FA862" />

      {/* Middle canopy layer */}
      <circle cx="28" cy="22" r="13" fill="#7AB86D" />
      <circle cx="36" cy="24" r="12" fill="#7AB86D" />

      {/* Front canopy layer */}
      <circle cx="32" cy="20" r="11" fill="#8BC573" />

      {/* Highlight spots */}
      <circle cx="30" cy="18" r="5" fill="#A8D88E" opacity="0.6" />
      <circle cx="36" cy="22" r="4" fill="#A8D88E" opacity="0.5" />
      <circle cx="26" cy="24" r="3" fill="#A8D88E" opacity="0.4" />
    </svg>
  );
}




interface IconProps {
  size?: number;
  className?: string;
}

export function IconHoles({ size = 64, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Green base shadow */}
      <ellipse cx="32" cy="48" rx="22" ry="8" fill="#5C8A4E" opacity="0.3" />

      {/* Green base */}
      <ellipse cx="32" cy="46" rx="20" ry="7" fill="#7AB86D" />
      <ellipse cx="32" cy="45" rx="18" ry="6" fill="#8BC573" />

      {/* Flag pole */}
      <rect x="30" y="18" width="2.5" height="28" rx="1.25" fill="#8B7355" />

      {/* Flag */}
      <path
        d="M32.5 18C32.5 18 38 20 42 22C42 22 42 28 42 30C38 28 32.5 26 32.5 26V18Z"
        fill="#D84848"
      />

      {/* Flag highlight */}
      <path
        d="M32.5 18C32.5 18 36 19.5 39 21C39 21 39 25 39 26.5C36 25 32.5 23.5 32.5 23.5V18Z"
        fill="#E85D5D"
      />

      {/* Hole */}
      <ellipse cx="32" cy="45" rx="3" ry="2" fill="#4A6B42" />
    </svg>
  );
}




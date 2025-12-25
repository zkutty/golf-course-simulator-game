interface IconProps {
  size?: number;
  className?: string;
}

export function IconReputation({ size = 64, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Outer star glow */}
      <path
        d="M32 8L37.5 23.5L54 26L42 37L45.5 54L32 45.5L18.5 54L22 37L10 26L26.5 23.5L32 8Z"
        fill="#F4D03F"
        opacity="0.3"
      />
      {/* Main star body */}
      <path
        d="M32 12L36.5 25L51 27.5L40.5 37L43.5 51L32 43.5L20.5 51L23.5 37L13 27.5L27.5 25L32 12Z"
        fill="#F9E79F"
      />
      {/* Inner highlight */}
      <path
        d="M32 16L35 25.5L45 27L37.5 34L39.5 44.5L32 39L24.5 44.5L26.5 34L19 27L29 25.5L32 16Z"
        fill="#FEF5B7"
      />
    </svg>
  );
}




interface IconProps {
  size?: number;
  className?: string;
}

export function IconCondition({ size = 64, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Grass tuft base */}
      <ellipse cx="32" cy="50" rx="18" ry="6" fill="#5C8A4E" opacity="0.3" />

      {/* Left blade */}
      <path
        d="M24 48C24 48 22 40 20 32C18 24 18 16 22 14C26 12 28 20 28 28C28 36 26 44 24 48Z"
        fill="#6FA862"
      />

      {/* Center blade */}
      <path
        d="M32 50C32 50 30 40 30 30C30 20 30 12 32 10C34 8 36 12 36 22C36 32 34 42 32 50Z"
        fill="#8BC573"
      />

      {/* Right blade */}
      <path
        d="M40 48C40 48 42 40 44 32C46 24 46 16 42 14C38 12 36 20 36 28C36 36 38 44 40 48Z"
        fill="#7AB86D"
      />

      {/* Highlights */}
      <path
        d="M32 50C32 50 31 42 31 32C31 22 31 14 32 12C32.5 11 33 12 33 20C33 28 32.5 38 32 50Z"
        fill="#A8D88E"
        opacity="0.6"
      />
    </svg>
  );
}





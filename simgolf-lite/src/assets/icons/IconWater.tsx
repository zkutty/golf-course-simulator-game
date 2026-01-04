interface IconProps {
  size?: number;
  className?: string;
}

export function IconWater({ size = 64, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Water body */}
      <path
        d="M12 32C12 32 16 28 22 28C28 28 30 32 36 32C42 32 46 28 52 28C52 28 54 30 54 34C54 38 54 42 52 44C52 44 46 48 36 48C26 48 18 48 14 44C10 40 12 36 12 32Z"
        fill="#6B9EBF"
      />

      {/* Water highlight */}
      <path
        d="M14 32C14 32 18 29 22 29C28 29 30 32 36 32C42 32 46 29 50 29C50 29 52 30 52 33C52 36 52 38 50 40C50 40 46 42 36 42C26 42 20 42 16 40C14 38 14 35 14 32Z"
        fill="#87B5D1"
      />

      {/* Top wave */}
      <path
        d="M14 30C14 30 18 28 22 28C28 28 30 30 36 30C42 30 46 28 50 28"
        stroke="#A8CFDF"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />

      {/* Water shimmer */}
      <ellipse cx="24" cy="36" rx="3" ry="2" fill="#B8DCE8" opacity="0.5" />
      <ellipse cx="40" cy="38" rx="4" ry="2.5" fill="#B8DCE8" opacity="0.4" />
    </svg>
  );
}






interface IconProps {
  size?: number;
  className?: string;
}

export function IconSand({ size = 64, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Bunker shadow */}
      <path
        d="M32 14C20 14 12 22 10 28C8 34 8 40 12 44C16 48 24 52 32 52C40 52 48 48 52 44C56 40 56 34 54 28C52 22 44 14 32 14Z"
        fill="#B8935F"
        opacity="0.3"
      />

      {/* Main bunker shape */}
      <path
        d="M32 16C22 16 14 24 12 28C10 32 10 38 14 42C18 46 24 50 32 50C40 50 46 46 50 42C54 38 54 32 52 28C50 24 42 16 32 16Z"
        fill="#D4B876"
      />

      {/* Inner sand */}
      <path
        d="M32 20C24 20 18 26 16 30C14 33 14 38 17 41C20 44 26 46 32 46C38 46 44 44 47 41C50 38 50 33 48 30C46 26 40 20 32 20Z"
        fill="#E6D29F"
      />

      {/* Lightest center */}
      <ellipse cx="32" cy="33" rx="12" ry="10" fill="#F2E8C9" />

      {/* Sand texture dots */}
      <circle cx="26" cy="30" r="1.5" fill="#C9A961" opacity="0.3" />
      <circle cx="36" cy="32" r="1" fill="#C9A961" opacity="0.3" />
      <circle cx="30" cy="38" r="1.5" fill="#C9A961" opacity="0.3" />
      <circle cx="38" cy="36" r="1" fill="#C9A961" opacity="0.3" />
    </svg>
  );
}






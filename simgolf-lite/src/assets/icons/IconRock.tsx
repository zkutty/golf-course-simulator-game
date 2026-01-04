interface IconProps {
  size?: number;
  className?: string;
}

export function IconRock({ size = 64, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <ellipse cx="32" cy="50" rx="18" ry="5" fill="#3D4A3E" opacity="0.3" />
      <path
        d="M32 16C32 16 38 18 42 22C46 26 48 32 48 38C48 42 46 46 42 48C38 50 34 50 32 50C28 50 24 50 20 48C16 46 14 42 14 38C14 32 16 26 20 22C24 18 28 16 32 16Z"
        fill="#8B8B7D"
      />
      <path
        d="M32 20C32 20 36 22 40 26C44 30 46 34 46 38C46 40 44 42 42 44C40 46 36 46 32 46C28 46 24 46 22 44C20 42 18 40 18 38C18 34 20 30 24 26C28 22 30 20 32 20Z"
        fill="#A09F93"
      />
      <path
        d="M32 24C32 24 34 26 36 28C38 30 40 32 40 36C40 38 38 40 36 40C34 40 32 40 32 40C28 40 26 40 26 40C24 40 22 38 22 36C22 32 24 30 26 28C28 26 30 24 32 24Z"
        fill="#B8B7AA"
      />
      <ellipse cx="32" cy="30" rx="8" ry="6" fill="#C9C8BC" />
      <ellipse cx="30" cy="28" rx="4" ry="3" fill="#D9D8CC" opacity="0.8" />
      <path
        d="M26 34C26 34 28 36 30 36"
        stroke="#8B8B7D"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.4"
      />
      <path
        d="M36 38C36 38 34 40 32 42"
        stroke="#8B8B7D"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.3"
      />
    </svg>
  );
}






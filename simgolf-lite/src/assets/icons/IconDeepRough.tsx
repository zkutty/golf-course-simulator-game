interface IconProps {
  size?: number;
  className?: string;
}

export function IconDeepRough({ size = 64, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Base shadow */}
      <ellipse cx="32" cy="50" rx="20" ry="6" fill="#3D5A35" opacity="0.3" />

      {/* Back cluster - darkest */}
      <path
        d="M18 48C18 48 16 42 16 36C16 30 16 24 18 22C20 20 22 26 22 32C22 38 20 44 18 48Z"
        fill="#4A6B42"
      />
      <path
        d="M26 48C26 48 24 40 24 32C24 24 24 18 26 16C28 14 30 20 30 28C30 36 28 44 26 48Z"
        fill="#4A6B42"
      />

      {/* Middle cluster */}
      <path
        d="M22 50C22 50 20 44 20 38C20 32 20 26 22 24C24 22 26 28 26 34C26 40 24 46 22 50Z"
        fill="#5C8A4E"
      />
      <path
        d="M32 50C32 50 30 42 30 34C30 26 30 20 32 18C34 16 36 22 36 30C36 38 34 46 32 50Z"
        fill="#5C8A4E"
      />
      <path
        d="M42 50C42 50 40 42 40 34C40 26 40 20 42 18C44 16 46 22 46 30C46 38 44 46 42 50Z"
        fill="#5C8A4E"
      />

      {/* Front cluster - lighter */}
      <path
        d="M28 52C28 52 26 46 26 40C26 34 26 28 28 26C30 24 32 30 32 36C32 42 30 48 28 52Z"
        fill="#6FA862"
      />
      <path
        d="M38 52C38 52 36 44 36 36C36 28 36 22 38 20C40 18 42 24 42 32C42 40 40 48 38 52Z"
        fill="#6FA862"
      />

      {/* Highlights on tips */}
      <path
        d="M32 50C32 50 31 44 31 38C31 32 31 26 32 24C32.5 23 33 26 33 32C33 38 32.5 44 32 50Z"
        fill="#7AB86D"
        opacity="0.5"
      />
    </svg>
  );
}





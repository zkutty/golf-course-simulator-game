interface IconProps {
  size?: number;
  className?: string;
}

export function IconBush({ size = 64, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <ellipse cx="32" cy="52" rx="20" ry="5" fill="#3D5A35" opacity="0.3" />
      <circle cx="24" cy="38" r="10" fill="#4A6B42" />
      <circle cx="40" cy="40" r="9" fill="#4A6B42" />
      <circle cx="18" cy="32" r="9" fill="#5C8A4E" />
      <circle cx="32" cy="34" r="12" fill="#5C8A4E" />
      <circle cx="44" cy="34" r="10" fill="#5C8A4E" />
      <circle cx="26" cy="28" r="10" fill="#6FA862" />
      <circle cx="38" cy="30" r="11" fill="#6FA862" />
      <circle cx="30" cy="24" r="8" fill="#7AB86D" />
      <circle cx="36" cy="26" r="7" fill="#7AB86D" />
      <circle cx="28" cy="22" r="4" fill="#8BC573" opacity="0.6" />
      <circle cx="38" cy="24" r="3" fill="#8BC573" opacity="0.5" />
      <circle cx="34" cy="28" r="2.5" fill="#A8D88E" opacity="0.4" />
    </svg>
  );
}




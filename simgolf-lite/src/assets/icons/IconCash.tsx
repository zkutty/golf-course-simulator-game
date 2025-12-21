interface IconProps {
  size?: number;
  className?: string;
}

export function IconCash({ size = 64, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Back coin */}
      <ellipse cx="28" cy="36" rx="14" ry="14" fill="#C9A961" />
      <ellipse cx="28" cy="36" rx="11" ry="11" fill="#D4B876" />
      <ellipse cx="28" cy="36" rx="8" ry="8" fill="#E6D29F" />

      {/* Middle coin */}
      <ellipse cx="34" cy="30" rx="14" ry="14" fill="#D4B876" />
      <ellipse cx="34" cy="30" rx="11" ry="11" fill="#E6D29F" />
      <ellipse cx="34" cy="30" rx="8" ry="8" fill="#F2E8C9" />
      <text
        x="34"
        y="34"
        fontSize="12"
        fontWeight="bold"
        fill="#C9A961"
        textAnchor="middle"
        fontFamily="serif"
      >
        $
      </text>

      {/* Front coin */}
      <ellipse cx="40" cy="24" rx="14" ry="14" fill="#E6D29F" />
      <ellipse cx="40" cy="24" rx="11" ry="11" fill="#F2E8C9" />
      <ellipse cx="40" cy="24" rx="8" ry="8" fill="#FAF3DC" />
      <text
        x="40"
        y="28"
        fontSize="12"
        fontWeight="bold"
        fill="#C9A961"
        textAnchor="middle"
        fontFamily="serif"
      >
        $
      </text>
    </svg>
  );
}



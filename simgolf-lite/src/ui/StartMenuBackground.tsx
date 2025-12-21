export function StartMenuBackground() {
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {/* Sky gradient */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(to bottom, #A8CFDF 0%, #E8D5C4 40%, #F2E8C9 100%)",
        }}
      />

      {/* Sun/light glow */}
      <div
        style={{
          position: "absolute",
          top: 80,
          right: "25%",
          width: 420,
          height: 420,
          borderRadius: 9999,
          opacity: 0.3,
          background: "radial-gradient(circle, #FFF5E6 0%, transparent 70%)",
          filter: "blur(40px)",
        }}
      />

      {/* Distant hills */}
      <svg
        style={{ position: "absolute", bottom: 0, width: "100%", opacity: 0.6 }}
        viewBox="0 0 1440 800"
        preserveAspectRatio="xMidYMid slice"
      >
        <path
          d="M0 500C200 450 400 480 600 460C800 440 1000 470 1200 450C1300 440 1400 450 1440 460V800H0V500Z"
          fill="#B8D5C4"
        />
        <path
          d="M0 550C150 520 350 540 550 530C750 520 950 545 1150 535C1300 528 1400 540 1440 545V800H0V550Z"
          fill="#9BC5A8"
        />
      </svg>

      {/* Main fairway and course */}
      <svg style={{ position: "absolute", bottom: 0, width: "100%" }} viewBox="0 0 1440 800" preserveAspectRatio="xMidYMid slice">
        <path
          d="M0 600C200 580 400 620 600 600C800 580 1000 610 1200 595C1300 590 1400 600 1440 605V800H0V600Z"
          fill="#7AB86D"
        />
        <path
          d="M0 650C150 640 300 660 500 650C700 640 900 665 1100 655C1250 648 1350 658 1440 660V800H0V650Z"
          fill="#6FA862"
        />
        <path
          d="M0 720C180 710 360 730 540 720C720 710 900 735 1080 725C1260 718 1350 728 1440 730V800H0V720Z"
          fill="#5C8A4E"
        />

        {/* Putting green */}
        <ellipse cx="900" cy="650" rx="80" ry="40" fill="#8BC573" />
        <ellipse cx="900" cy="650" rx="65" ry="32" fill="#9FD088" />
        <ellipse cx="900" cy="650" rx="4" ry="2" fill="#4A6B42" />
        <line x1="900" y1="650" x2="900" y2="610" stroke="#8B7355" strokeWidth="2" />
        <path
          d="M900 610C900 610 915 615 922 618C922 618 922 625 922 628C915 625 900 622 900 622V610Z"
          fill="#D84848"
        />

        {/* Sand bunker */}
        <ellipse cx="350" cy="680" rx="90" ry="45" fill="#E6D29F" />
        <ellipse cx="350" cy="680" rx="70" ry="35" fill="#F2E8C9" />

        {/* Trees */}
        <g opacity="0.7">
          <circle cx="200" cy="600" r="35" fill="#6FA862" />
          <circle cx="185" cy="590" r="28" fill="#7AB86D" />
          <circle cx="215" cy="595" r="25" fill="#7AB86D" />
          <rect x="195" y="630" width="10" height="30" rx="2" fill="#8B7355" />
        </g>
        <g opacity="0.7">
          <circle cx="1200" cy="620" r="40" fill="#6FA862" />
          <circle cx="1180" cy="608" r="32" fill="#7AB86D" />
          <circle cx="1220" cy="615" r="30" fill="#7AB86D" />
          <rect x="1193" y="655" width="14" height="35" rx="2" fill="#8B7355" />
        </g>
        <g opacity="0.8">
          <circle cx="1050" cy="640" r="32" fill="#6FA862" />
          <circle cx="1035" cy="632" r="26" fill="#7AB86D" />
          <circle cx="1065" cy="636" r="24" fill="#7AB86D" />
          <circle cx="1050" cy="628" r="22" fill="#8BC573" />
          <rect x="1044" y="668" width="12" height="28" rx="2" fill="#8B7355" />
        </g>

        {/* Foreground bushes */}
        <g opacity="0.9">
          <circle cx="150" cy="720" r="20" fill="#5C8A4E" />
          <circle cx="170" cy="722" r="18" fill="#6FA862" />
          <circle cx="160" cy="715" r="16" fill="#7AB86D" />
        </g>
        <g opacity="0.9">
          <circle cx="1300" cy="730" r="22" fill="#5C8A4E" />
          <circle cx="1320" cy="732" r="20" fill="#6FA862" />
          <circle cx="1310" cy="724" r="18" fill="#7AB86D" />
        </g>
      </svg>

      {/* Subtle noise texture */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.03,
          backgroundImage:
            'url("data:image/svg+xml,%3Csvg viewBox=%270 0 400 400%27 xmlns=%27http://www.w3.org/2000/svg%27%3E%3Cfilter id=%27noiseFilter%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.9%27 numOctaves=%274%27 stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect width=%27100%25%27 height=%27100%25%27 filter=%27url(%23noiseFilter)%27/%3E%3C/svg%3E")',
          backgroundRepeat: "repeat",
          backgroundSize: "180px 180px",
        }}
      />

      {/* Vignette */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(ellipse at center, transparent 0%, rgba(61, 74, 62, 0.15) 100%)",
        }}
      />
    </div>
  );
}



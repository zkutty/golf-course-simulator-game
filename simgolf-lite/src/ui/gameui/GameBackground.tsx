export function GameBackground() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: -10,
        background: "var(--cc-parchment)",
      }}
    >
      {/* Paper texture lines */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.15,
          backgroundImage: `
            repeating-linear-gradient(
              0deg,
              transparent,
              transparent 2px,
              rgba(91, 138, 78, 0.02) 2px,
              rgba(91, 138, 78, 0.02) 4px
            ),
            repeating-linear-gradient(
              90deg,
              transparent,
              transparent 2px,
              rgba(91, 138, 78, 0.02) 2px,
              rgba(91, 138, 78, 0.02) 4px
            )
          `,
          backgroundSize: "100px 100px",
        }}
      />

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

      {/* Soft vignette */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(ellipse at center, transparent 0%, rgba(61, 74, 62, 0.08) 100%)",
        }}
      />

      {/* Decorative blobs */}
      <div
        style={{
          position: "absolute",
          top: -200,
          right: -200,
          width: 420,
          height: 420,
          borderRadius: 9999,
          background: "var(--cc-grass)",
          opacity: 0.04,
          filter: "blur(60px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: -200,
          left: -200,
          width: 420,
          height: 420,
          borderRadius: 9999,
          background: "var(--cc-forest)",
          opacity: 0.04,
          filter: "blur(60px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: 420,
          height: 420,
          borderRadius: 9999,
          background: "var(--cc-sand)",
          opacity: 0.03,
          filter: "blur(60px)",
          transform: "translate(-50%, -50%)",
        }}
      />
    </div>
  );
}





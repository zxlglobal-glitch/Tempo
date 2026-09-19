export default function TempoHeroLogo() {
  return (
    <svg
      className="tempo-hero-logo-svg"
      viewBox="0 0 251 250"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient
          id="tempoHeroGradient"
          x1="60"
          y1="170"
          x2="190"
          y2="75"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#2E5C4B" />
          <stop offset="55%" stopColor="#245242" />
          <stop offset="100%" stopColor="#143A31" />
        </linearGradient>
      </defs>

      <rect
        x="35"
        y="169"
        width="92.95"
        height="41.43"
        rx="20.715"
        transform="rotate(-51.7098 35 169)"
        fill="url(#tempoHeroGradient)"
      />

      <rect
        x="101.53"
        y="79.08"
        width="44.41"
        height="143.17"
        rx="22.2"
        transform="rotate(-36.3844 101.53 79.08)"
        fill="url(#tempoHeroGradient)"
      />

      <text
        x="125.5"
        y="220"
        textAnchor="middle"
        fill="#223D35"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="11"
        fontWeight="700"
        letterSpacing="5.1"
      >
        KEEP MOVING
      </text>
    </svg>
  );
}

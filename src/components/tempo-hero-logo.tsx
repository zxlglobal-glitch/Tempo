export default function TempoHeroLogo() {
  return (
    <svg
      className="tempo-hero-logo-svg"
      viewBox="0 0 220 180"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient
          id="tempoIconGradient"
          x1="70"
          y1="20"
          x2="150"
          y2="150"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#214D40" />
          <stop offset="55%" stopColor="#173F34" />
          <stop offset="100%" stopColor="#102F28" />
        </linearGradient>
      </defs>

      <path
        d="M102 24 L102 47 L121 47 C125 47 128 50 128 54 L128 66 C128 70 125 73 121 73 L102 73 L102 110 C102 123 109 130 122 130 L132 130 C136 130 139 133 139 137 L139 149 C139 154 136 157 131 157 L118 157 C89 157 72 141 72 113 L72 73 L61 73 C56 73 53 70 53 66 L53 54 C53 50 56 47 61 47 L72 47 L72 39 C72 35 74 32 78 30 L96 22 C99 21 102 22 102 24 Z"
        fill="url(#tempoIconGradient)"
      />

      <circle cx="157" cy="129" r="14" fill="#E69D5B" />

      <text
        x="110"
        y="174"
        textAnchor="middle"
        fill="#18382F"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="9.5"
        fontWeight="700"
        letterSpacing="4.6"
      >
        KEEP MOVING
      </text>
    </svg>
  );
}

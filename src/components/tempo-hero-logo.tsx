export default function TempoHeroLogo() {
  return (
    <svg
      className="tempo-hero-logo-svg"
      viewBox="0 0 180 180"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="tempoBadgeBg" x1="0" y1="0" x2="180" y2="180" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FBF9F4" />
          <stop offset="100%" stopColor="#F1EEE7" />
        </linearGradient>
        <linearGradient id="tempoTGradient" x1="58" y1="48" x2="118" y2="132" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#173D34" />
          <stop offset="60%" stopColor="#10332B" />
          <stop offset="100%" stopColor="#0A2822" />
        </linearGradient>
        <linearGradient id="tempoDotGradient" x1="119" y1="112" x2="145" y2="140" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#F0A35F" />
          <stop offset="100%" stopColor="#E78E4C" />
        </linearGradient>
      </defs>

      <rect x="8" y="8" width="164" height="164" rx="38" fill="url(#tempoBadgeBg)" />

      <path
        d="M78 43
           C78 39 81 36 85 34
           L104 26
           C108 24 111 26 111 30
           V52
           H126
           C131 52 134 55 134 60
           V72
           C134 77 131 80 126 80
           H111
           V111
           C111 122 117 128 128 128
           H137
           C142 128 145 131 145 136
           V148
           C145 153 142 156 137 156
           H123
           C94 156 78 140 78 114
           V80
           H67
           C62 80 59 77 59 72
           V60
           C59 55 62 52 67 52
           H78
           Z"
        fill="url(#tempoTGradient)"
      />

      <circle cx="143" cy="132" r="13" fill="url(#tempoDotGradient)" />
    </svg>
  );
}

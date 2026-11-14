type P = { size?: number; className?: string };
const base = (size = 18) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const Mark = ({ size = 22, className }: P) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <path
      fill="currentColor"
      fillRule="evenodd"
      d="M12 1.6 20.4 4.8V11c0 5.4-3.5 9.6-8.4 11.4C7.1 20.6 3.6 16.4 3.6 11V4.8Zm0 2.1L5.6 6.2V11c0 4.2 2.6 7.6 6.4 9.2 3.8-1.6 6.4-5 6.4-9.2V6.2Zm-1.4 10.9-2.7-2.7 1.4-1.4 1.3 1.3 4.2-4.2 1.4 1.4Z"
    />
  </svg>
);
export const Arrow = ({ size }: P) => (
  <svg {...base(size ?? 16)} className="arrow">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
export const Copy = ({ size }: P) => (
  <svg {...base(size ?? 15)} className="cp">
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
  </svg>
);
export const Check = ({ size, className }: P) => (
  <svg {...base(size ?? 15)} className={className ?? "ok"}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);
export const Github = ({ size = 17 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <path
      fill="currentColor"
      d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"
    />
  </svg>
);
export const Linkedin = ({ size = 16 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <path
      fill="currentColor"
      d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9.75h4v11.5H3V9.75Zm6.5 0h3.83v1.57h.06c.53-1 1.84-2.07 3.8-2.07 4.06 0 4.81 2.67 4.81 6.15v5.85h-4v-5.19c0-1.24-.02-2.83-1.73-2.83-1.73 0-2 1.35-2 2.74v5.28h-4V9.75Z"
    />
  </svg>
);
export const XLogo = ({ size = 15 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <path
      fill="currentColor"
      d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.32l4.37 5.78L17.75 3Zm-1.08 16.17h1.7L7.4 4.74H5.58l11.09 14.43Z"
    />
  </svg>
);
export const Instagram = ({ size = 16 }: P) => (
  <svg {...base(size)}>
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
  </svg>
);
export const Menu = ({ size }: P) => (
  <svg {...base(size ?? 18)}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);
export const Close = ({ size }: P) => (
  <svg {...base(size ?? 18)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
export const Sun = ({ size, className }: P) => (
  <svg {...base(size ?? 17)} className={className}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
  </svg>
);
export const Moon = ({ size, className }: P) => (
  <svg {...base(size ?? 17)} className={className}>
    <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7Z" />
  </svg>
);
export const Search = ({ size }: P) => (
  <svg {...base(size ?? 17)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);
export const Shield = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M12 3 19 6v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3Z" />
  </svg>
);
export const Bolt = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M13 3 5 14h6l-1 7 8-11h-6l1-7Z" />
  </svg>
);
export const Rewind = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
  </svg>
);
export const Coins = ({ size }: P) => (
  <svg {...base(size)}>
    <ellipse cx="9" cy="7" rx="6" ry="3" />
    <path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7M9 15v2c0 1.7 2.7 3 6 3s6-1.3 6-3v-5c0-1.6-2.4-2.9-5.5-3" />
  </svg>
);
export const Sparkle = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
  </svg>
);
export const Badge = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="12" cy="9" r="6" />
    <path d="m8.5 14-1.5 7 5-3 5 3-1.5-7M9.5 9l1.8 1.8L15 7.2" />
  </svg>
);
export const ReceiptIco = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 8h6M9 12h6M9 16h3" />
  </svg>
);
export const Sliders = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />
  </svg>
);

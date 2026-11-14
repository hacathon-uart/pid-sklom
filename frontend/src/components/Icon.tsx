/** Icon/* from Figma: 24 px stroke icons. Replace paths with exported SVGs if they differ. */
const PATHS = {
  home: "M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z",
  pencil: "M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4",
  image: "M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 9.5h.01",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  heart: "M12 20s-7-4.5-9-9a4.5 4.5 0 0 1 9-2 4.5 4.5 0 0 1 9 2c-2 4.5-9 9-9 9z",
  bookmark: "M6 3h12v18l-6-4-6 4z",
  download: "M12 4v11m0 0-4-4m4 4 4-4M4 20h16",
  share: "M12 15V4m0 0L8 8m4-4 4 4M5 13v7h14v-7",
  refresh: "M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5",
  chevronDown: "m6 9 6 6 6-6",
  arrowRight: "M5 12h14m0 0-5-5m5 5-5 5",
  arrowLeft: "M19 12H5m0 0 5-5m-5 5 5 5",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm9 3-4.5-4.5",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 24, filled = false }: { name: IconName; size?: number; filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** 24 px stroke icons, drawn as museum objects. Each entry is one SVG path (subpaths allowed). */
const PATHS = {
  // Museum objects (direction board, I1). Heart stays a heart.
  home: "M3 9 12 4l9 5zM4.5 11h15M6 11v8M10 11v8M14 11v8M18 11v8M3 21h18", // museum portico
  pencil: "M20 3C12 4 7 10 5 19l-1 2M5 19c7-1 12-6 15-16M9 14h4", // quill
  image: "M3 6h18v15H3zM6.5 9.5h11v8h-11zM9 6l3-3.5L15 6", // painting on a hanging cord
  quiz: "M4 3h16v18H4zM9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.8M12 16.8v.2", // a framed question
  user: "M9 2.5h6v3H9zM5.5 5.5h13V21h-13zM12 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM9 17.5h6", // visitor badge
  heart: "M12 20s-7-4.5-9-9a4.5 4.5 0 0 1 9-2 4.5 4.5 0 0 1 9 2c-2 4.5-9 9-9 9z",
  bookmark: "M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4zM14 7v2M14 11v2M14 15v2", // ticket to the collection
  download: "M4 10h16v10H4zM4 10l2-4h12l2 4M12 2.5v9M9 8.5l3 3 3-3", // into a crate
  share: "M3 6h18v12H3zM15 8.5h3.5V12H15zM6 10h6M6 13h5M6 15.5h4", // museum-shop postcard
  refresh: "M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5",
  chevronDown: "m6 9 6 6 6-6",
  arrowRight: "M5 12h14m0 0-5-5m5 5-5 5",
  arrowLeft: "M19 12H5m0 0 5-5m-5 5 5 5",
  chevronLeft: "m15 6-6 6 6 6",
  chevronRight: "m9 6 6 6-6 6",
  close: "M6 6l12 12M18 6 6 18",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  sound: "M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11",
  soundOff: "M4 9h4l5-4v14l-5-4H4zM16 9.5l5 5M21 9.5l-5 5",
  zoom:"M10.5 16a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM14.5 14.5 20 20M10.5 8v5M8 10.5h5", // loupe with a plus
  search: "M10.5 16a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM14.5 14.5 20 20M7.5 9a3 3 0 0 1 2.5-2", // restorer's loupe
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

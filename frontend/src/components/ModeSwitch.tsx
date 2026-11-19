import { Link, useLocation } from "react-router";

/** «Фраза → картина / Картина → підпис» — jumps between screens 2 and 2b. */
export function ModeSwitch() {
  const paintingMode = useLocation().pathname.startsWith("/create/painting");
  const item = (active: boolean) =>
    `flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-control px-2 py-2.5 text-center text-sm leading-snug transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:px-5 sm:text-[15px] ${active ? "bg-surface font-semibold shadow-sm" : "text-text-secondary"}`;
  return (
    <div className="flex w-full min-w-0 gap-1 rounded-card bg-muted p-1 lg:w-auto">
      <Link to="/create" aria-current={!paintingMode ? "page" : undefined} className={item(!paintingMode)}>
        Фраза → картина
      </Link>
      <Link to="/create/painting" aria-current={paintingMode ? "page" : undefined} className={item(paintingMode)}>
        Картина → підпис
      </Link>
    </div>
  );
}

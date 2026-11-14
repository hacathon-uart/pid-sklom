import { Link, useLocation } from "react-router";

/** «Фраза → картина / Картина → підпис» — jumps between screens 2 and 2b. */
export function ModeSwitch() {
  const paintingMode = useLocation().pathname.startsWith("/create/painting");
  const item = (active: boolean) =>
    `rounded-control px-5 py-2.5 text-[15px] transition ${active ? "bg-surface font-semibold shadow-sm" : "text-text-secondary"}`;
  return (
    <div className="flex gap-1 rounded-card bg-muted p-1">
      <Link to="/create" className={item(!paintingMode)}>
        Фраза → картина
      </Link>
      <Link to="/create/painting" className={item(paintingMode)}>
        Картина → підпис
      </Link>
    </div>
  );
}

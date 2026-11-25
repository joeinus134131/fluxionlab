"use client";

/** Tombol dan petunjuk yang menempel di atas canvas. */
export function ViewControls({ hint, children }: { hint: string; children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-x-2 bottom-2 flex flex-wrap items-end justify-between gap-2">
      <p className="hidden rounded bg-black/60 px-2 py-1 text-xs text-zinc-300 sm:block">{hint}</p>
      <div className="pointer-events-auto ml-auto flex gap-1 rounded-md bg-black/70 p-1">{children}</div>
    </div>
  );
}

export function ViewButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      className={`min-w-8 rounded px-2 py-1 text-sm text-zinc-100 ${pressed ? "bg-indigo-600" : "hover:bg-white/15"}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

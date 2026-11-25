"use client";

export const buttonClass =
  "rounded-md border border-current/20 px-3 py-1.5 text-sm hover:bg-current/10 disabled:opacity-40";
export const primaryClass = "rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-40";
export const inputClass = "w-full rounded-md border border-current/20 bg-transparent px-2 py-1.5 text-sm";

type TabsProps<K extends string> = {
  label: string;
  tabs: readonly (readonly [K, string])[];
  active: K;
  onChange: (key: K) => void;
};

/** Bilah tab dengan navigasi panah, Home, dan End. */
export function Tabs<K extends string>({ label, tabs, active, onChange }: TabsProps<K>) {
  return (
    <div
      className="flex border-b border-current/15"
      role="tablist"
      aria-label={label}
      onKeyDown={(event) => {
        const index = tabs.findIndex(([key]) => key === active);
        const target = {
          ArrowRight: index + 1,
          ArrowLeft: index - 1,
          Home: 0,
          End: tabs.length - 1,
        }[event.key];
        if (target === undefined) return;
        event.preventDefault();
        const next = (target + tabs.length) % tabs.length;
        onChange(tabs[next][0]);
        (event.currentTarget.children[next] as HTMLElement).focus();
      }}
    >
      {tabs.map(([key, text]) => (
        <button
          key={key}
          id={`tab-${key}`}
          role="tab"
          aria-selected={active === key}
          aria-controls="tab-panel"
          tabIndex={active === key ? 0 : -1}
          className={`flex-1 border-b-2 py-2.5 text-sm ${active === key ? "border-indigo-500 font-semibold" : "border-transparent opacity-60"}`}
          onClick={() => onChange(key)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

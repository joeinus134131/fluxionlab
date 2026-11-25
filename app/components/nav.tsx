"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const MENU = [
  { href: "/", label: "Beranda" },
  { href: "/studio", label: "Desain 3D" },
  { href: "/pcb", label: "Desain PCB" },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <header className="flex h-14 items-center gap-6 border-b border-current/15 px-4">
      <span className="font-semibold">FluxionLab</span>
      <nav className="flex gap-1">
        {MENU.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            aria-current={pathname === href ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-sm ${pathname === href ? "bg-current/10 font-medium" : "opacity-70 hover:opacity-100"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

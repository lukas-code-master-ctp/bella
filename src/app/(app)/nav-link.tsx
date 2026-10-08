"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LinkPending } from "@/components/link-pending";

export function NavLink({ href, icon, children }: { href: string; icon?: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 [&_svg]:size-[18px] [&_svg]:shrink-0 ${
        active
          ? "bg-brand-50 text-brand-700 [&_svg]:text-brand-600"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 [&_svg]:text-slate-500"
      }`}
    >
      {icon}
      {children}
      <LinkPending className="mx-3" />
    </Link>
  );
}

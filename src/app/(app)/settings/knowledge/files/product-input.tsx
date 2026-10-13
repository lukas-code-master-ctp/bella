"use client";

import { useState } from "react";
import { inputClass } from "@/components/ui";

/** Campo de producto con los ya usados como botones (la lista nativa del navegador no se abre en todos). */
export function ProductInput({ products, defaultValue = "" }: { products: string[]; defaultValue?: string }) {
  const [value, setValue] = useState(defaultValue);
  const others = products.filter((p) => p !== value.trim());
  return (
    <div className="space-y-2">
      <input
        name="product"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ej. Proyecto Los Robles"
        autoComplete="off"
        className={inputClass}
      />
      {others.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {others.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setValue(p)}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-medium text-slate-700 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

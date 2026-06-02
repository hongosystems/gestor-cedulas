"use client";

import { usePathname } from "next/navigation";
import { usePageSearch } from "./PageSearchContext";
import { getPageSearchConfig } from "@/lib/page-search-config";

export default function GlobalSearch() {
  const pathname = usePathname();
  const { value, onChange } = usePageSearch();
  const { placeholder } = getPageSearchConfig(pathname);

  return (
    <div className="app-shell-search" role="search">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
        <path d="M20 20l-3-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        spellCheck={false}
      />
      {value && (
        <button
          type="button"
          className="app-shell-search-clear"
          onClick={() => onChange("")}
          aria-label="Limpiar búsqueda"
          title="Limpiar"
        >
          ×
        </button>
      )}
    </div>
  );
}

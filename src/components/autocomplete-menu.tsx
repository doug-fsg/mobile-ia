"use client";

export type AutocompleteKind = "skill" | "file" | "folder";

export interface AutocompleteItem {
  id: string;
  kind: AutocompleteKind;
  label: string;
  detail?: string;
  insert: string;
  path?: string;
}

interface AutocompleteMenuProps {
  open: boolean;
  items: AutocompleteItem[];
  selectedIndex: number;
  loading?: boolean;
  title: string;
  onSelect: (item: AutocompleteItem) => void;
  onHover: (index: number) => void;
}

export function AutocompleteMenu({
  open,
  items,
  selectedIndex,
  loading,
  title,
  onSelect,
  onHover,
}: AutocompleteMenuProps) {
  if (!open) return null;

  return (
    <div
      role="listbox"
      aria-label={title}
      className="absolute bottom-full left-0 right-0 mb-1 z-50 max-h-56 overflow-y-auto rounded-lg border border-border bg-bg-elevated shadow-xl"
    >
      <div className="sticky top-0 z-10 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-text-muted bg-bg-elevated border-b border-border">
        {title}
        {loading ? " · carregando…" : items.length === 0 ? " · sem resultados" : ""}
      </div>
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={i === selectedIndex}
          onMouseEnter={() => onHover(i)}
          onClick={() => onSelect(item)}
          className={`w-full text-left px-3 py-2 text-[12px] flex items-start gap-2 transition-colors ${
            i === selectedIndex ? "bg-bg-active text-text" : "text-text-secondary hover:bg-bg-hover"
          }`}
        >
          <span
            className={`shrink-0 mt-0.5 text-[9px] px-1 py-px rounded font-medium ${
              item.kind === "skill"
                ? "bg-accent/15 text-accent"
                : item.kind === "folder"
                  ? "bg-warning/15 text-warning"
                  : "bg-bg-hover text-text-muted"
            }`}
          >
            {item.kind === "skill" ? "/" : item.kind === "folder" ? "@/" : "@"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-text">{item.label}</span>
            {item.detail && (
              <span className="block truncate text-[10px] text-text-muted mt-0.5">{item.detail}</span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

"use client";

import { useId, useState } from "react";

type ExpandableTextProps = {
  text: string | null | undefined;
  emptyLabel?: string;
  maxLines?: number;
  className?: string;
};

export default function ExpandableText({
  text,
  emptyLabel = "—",
  maxLines = 3,
  className = "",
}: ExpandableTextProps) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const value = (text || "").trim();

  if (!value) {
    return <span className={`notes-cell notes-cell--empty ${className}`.trim()}>{emptyLabel}</span>;
  }

  const isLong = value.length > 100 || value.split("\n").length > maxLines;

  return (
    <div className={`notes-cell ${className}`.trim()}>
      <div
        id={id}
        className={`notes-cell__body${expanded ? " is-expanded" : ""}`}
        style={
          expanded ? undefined : ({ WebkitLineClamp: maxLines } as React.CSSProperties)
        }
        title={!expanded && isLong ? value : undefined}
      >
        {value}
      </div>
      {isLong && (
        <button
          type="button"
          className="notes-cell__toggle"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          aria-expanded={expanded}
        >
          {expanded ? "Ver menos" : "Ver más"}
        </button>
      )}
    </div>
  );
}

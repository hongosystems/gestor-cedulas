"use client";

import { useId, useState } from "react";

type NotesCellProps = {
  text: string | null | undefined;
  emptyLabel?: string;
  maxCollapsedLines?: number;
};

export default function NotesCell({
  text,
  emptyLabel = "Sin contenido",
  maxCollapsedLines = 3,
}: NotesCellProps) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const value = (text || "").trim();

  if (!value) {
    return <span className="notes-cell notes-cell--empty">{emptyLabel}</span>;
  }

  const isLong = value.length > 120 || value.split("\n").length > maxCollapsedLines;

  return (
    <div className="notes-cell">
      <div
        id={id}
        className={`notes-cell__body${expanded ? " is-expanded" : ""}`}
        style={
          expanded
            ? undefined
            : ({ WebkitLineClamp: maxCollapsedLines } as React.CSSProperties)
        }
        title={!expanded && isLong ? value : undefined}
      >
        {value}
      </div>
      {isLong && (
        <button
          type="button"
          className="notes-cell__toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={id}
        >
          {expanded ? "Ver menos" : "Ver completo"}
        </button>
      )}
    </div>
  );
}

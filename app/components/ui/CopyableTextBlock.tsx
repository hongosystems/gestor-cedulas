"use client";

type CopyableTextBlockProps = {
  label: string;
  text: string | null | undefined;
  emptyLabel?: string;
};

export default function CopyableTextBlock({
  label,
  text,
  emptyLabel = "Sin contenido",
}: CopyableTextBlockProps) {
  const value = (text || "").trim();

  async function handleCopy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      /* ignorar */
    }
  }

  return (
    <div className="mj-detail-card">
      <div className="mj-detail-card__head">
        <span className="mj-detail-card__label">{label}</span>
        {value ? (
          <button type="button" className="mj-detail-card__copy" onClick={handleCopy}>
            Copiar
          </button>
        ) : null}
      </div>
      {value ? (
        <pre className="mj-detail-card__body">{value}</pre>
      ) : (
        <p className="mj-detail-card__empty">{emptyLabel}</p>
      )}
    </div>
  );
}

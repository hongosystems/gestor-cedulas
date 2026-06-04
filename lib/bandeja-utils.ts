export type Profile = { id: string; full_name: string | null; email: string | null };

export type DocType = "CEDULA" | "OFICIO" | "OTROS_ESCRITOS";

export function displayName(p?: Profile | null) {
  const name = (p?.full_name || "").trim();
  if (name) return name;
  const email = (p?.email || "").trim();
  if (email) return email;
  return "Sin nombre";
}

export function docTypeLabel(docType: DocType | string | null | undefined) {
  if (docType === "OFICIO") return "Oficio";
  if (docType === "OTROS_ESCRITOS") return "Causas Penales";
  if (docType === "CEDULA") return "Cédula";
  return "Documento";
}

export function fmtDateShort(iso: string) {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

export function fmtRelativeTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Ahora";
  if (diffMins < 60) return `Hace ${diffMins} min`;
  if (diffHours < 24) return `Hace ${diffHours} h`;
  if (diffDays === 1) return "Ayer";
  if (diffDays < 7) return `Hace ${diffDays} días`;

  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

export function snippet(text: string, maxLen = 120) {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

export type BandejaTab =
  | "recibidos"
  | "enviados"
  | "archivados"
  | "todas"
  | "no-leidas"
  | "accion"
  | "nuevo";

export function parseBandejaTab(raw: string | null | undefined): BandejaTab {
  const v = (raw || "").toLowerCase();
  if (
    v === "recibidos" ||
    v === "enviados" ||
    v === "archivados" ||
    v === "todas" ||
    v === "no-leidas" ||
    v === "accion" ||
    v === "nuevo"
  ) {
    return v;
  }
  if (v === "notificaciones") return "todas";
  return "todas";
}

export function canWorkflowCedulas(roles: {
  isSuperadmin: boolean;
  isAbogado: boolean;
  isAdminExpedientes: boolean;
  isAdminCedulas: boolean;
}) {
  return (
    roles.isSuperadmin ||
    roles.isAbogado ||
    roles.isAdminExpedientes ||
    roles.isAdminCedulas
  );
}

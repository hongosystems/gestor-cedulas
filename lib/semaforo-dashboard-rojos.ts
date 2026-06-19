import type { BarChartItem, SemaforoRojosBreakdown } from "@/app/components/ui/CssBarChart";

export type DocumentoRojoTipo = "CEDULA" | "OFICIO" | "EXPEDIENTE";

export type DocumentoRojoDashboard = {
  id: string;
  tipo: DocumentoRojoTipo;
  tipoLabel: string;
  caratula: string;
  juzgado: string | null;
  juzgadoKey: string;
  dias: number | null;
  ownerUserId: string | null;
  ownerName: string;
  href: string;
};

/** Clave canónica de juzgado — misma que agrupan barras, filtro y modal. */
export const SIN_JUZGADO_KEY = "Sin juzgado";

export function juzgadoKeyFromRaw(juzgado: string | null | undefined): string {
  return (juzgado || SIN_JUZGADO_KEY).trim() || SIN_JUZGADO_KEY;
}

export function matchesJuzgadoFilter(
  juzgado: string | null | undefined,
  filterKey: string
): boolean {
  return juzgadoKeyFromRaw(juzgado) === filterKey;
}

export function sortJuzgadoKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    if (a === SIN_JUZGADO_KEY) return 1;
    if (b === SIN_JUZGADO_KEY) return -1;
    return a.localeCompare(b, "es", { numeric: true, sensitivity: "base" });
  });
}

export function collectJuzgadoKeysFromSources(
  sources: ReadonlyArray<{ juzgado?: string | null }>
): string[] {
  const set = new Set<string>();
  for (const s of sources) {
    set.add(juzgadoKeyFromRaw(s.juzgado));
  }
  return sortJuzgadoKeys([...set]);
}

export const JUZGADO_FILTER_SPECIAL = new Set([
  "todos",
  "mis_juzgados",
  "beneficio",
  "prueba_pericia",
]);

export function isJuzgadoFilterKey(value: string): boolean {
  return !JUZGADO_FILTER_SPECIAL.has(value);
}

function emptyBreakdown(): SemaforoRojosBreakdown {
  return { exp: 0, ced: 0, of: 0 };
}

function bumpBreakdown(b: SemaforoRojosBreakdown, tipo: DocumentoRojoTipo) {
  if (tipo === "EXPEDIENTE") b.exp++;
  else if (tipo === "OFICIO") b.of++;
  else b.ced++;
}

export function buildJuzgadoRojosChart(documentos: DocumentoRojoDashboard[]): BarChartItem[] {
  const perJuzgado = new Map<string, SemaforoRojosBreakdown & { total: number }>();

  for (const doc of documentos) {
    const key = doc.juzgadoKey;
    const cur = perJuzgado.get(key) ?? { ...emptyBreakdown(), total: 0 };
    cur.total++;
    bumpBreakdown(cur, doc.tipo);
    perJuzgado.set(key, cur);
  }

  return [...perJuzgado.entries()]
    .map(([label, v]) => ({
      label,
      value: v.total,
      tone: "red" as const,
      breakdown: { exp: v.exp, ced: v.ced, of: v.of },
      drilldownKind: "juzgado" as const,
      drilldownKey: label,
    }))
    .sort((a, b) => b.value - a.value);
}

export const SIN_RESPONSABLE_KEY = "__sin_responsable__";
export const SIN_RESPONSABLE_LABEL = "Sin responsable";

export function buildResponsableRojosChart(documentos: DocumentoRojoDashboard[]): BarChartItem[] {
  const perUser = new Map<
    string,
    SemaforoRojosBreakdown & { total: number; name: string }
  >();

  for (const doc of documentos) {
    const hasOwner = Boolean(doc.ownerUserId?.trim());
    const uid = hasOwner ? doc.ownerUserId! : SIN_RESPONSABLE_KEY;
    const cur = perUser.get(uid) ?? {
      ...emptyBreakdown(),
      total: 0,
      name: hasOwner ? doc.ownerName || uid : SIN_RESPONSABLE_LABEL,
    };
    cur.total++;
    bumpBreakdown(cur, doc.tipo);
    if (hasOwner && doc.ownerName) cur.name = doc.ownerName;
    perUser.set(uid, cur);
  }

  return [...perUser.entries()]
    .map(([uid, v]) => ({
      label: v.name,
      value: v.total,
      tone: "red" as const,
      breakdown: { exp: v.exp, ced: v.ced, of: v.of },
      drilldownKind: "responsable" as const,
      drilldownKey: uid,
      muted: uid === SIN_RESPONSABLE_KEY,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
}

export function filterDocumentosRojos(
  documentos: DocumentoRojoDashboard[],
  kind: "juzgado" | "responsable",
  key: string
): DocumentoRojoDashboard[] {
  if (kind === "juzgado") {
    return documentos.filter((d) => d.juzgadoKey === key);
  }
  if (key === SIN_RESPONSABLE_KEY) {
    return documentos.filter((d) => !d.ownerUserId?.trim());
  }
  return documentos.filter((d) => d.ownerUserId === key);
}

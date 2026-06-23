/** Tipos y helpers compartidos entre alta/edición/PDF de mediaciones. */

export type RequeridoForm = {
  id: string;
  nombre: string;
  empresa_nombre_razon_social: string;
  domicilio: string;
  lesiones: string;
};

export type AseguradoraFormItem = {
  requeridoId: string;
  matricula: string;
  denominacion: string;
  cuit: string;
  domicilio?: { direccion?: string; localidad?: string; provincia?: string } | null;
  poliza: string;
  numeroSiniestro: string;
  domicilioManual: boolean;
};

export type RequeridoDbRow = {
  id?: string;
  nombre?: string | null;
  empresa_nombre_razon_social?: string | null;
  condicion?: string | null;
  domicilio?: string | null;
  lesiones?: string | null;
  es_aseguradora?: boolean | null;
  aseguradora_nombre?: string | null;
  aseguradora_domicilio?: string | null;
  orden?: number | null;
};

function parseDomicilioAseguradora(domicilio: string | null | undefined) {
  if (!domicilio?.trim()) {
    return { direccion: "", localidad: "", provincia: "" };
  }
  const parts = domicilio.split(",").map((p) => p.trim());
  return {
    direccion: parts[0] || "",
    localidad: parts[1] || "",
    provincia: parts[2] || "",
  };
}

function newRequeridoId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Convierte filas de BD al estado del formulario (requeridos + aseguradoras del combobox). */
export function requeridosFromDb(rows: RequeridoDbRow[]): {
  requeridos: RequeridoForm[];
  aseguradoras: AseguradoraFormItem[];
} {
  const sorted = [...rows].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  const requeridos: RequeridoForm[] = [];
  const aseguradoras: AseguradoraFormItem[] = [];
  let lastRequeridoId = "";

  for (const r of sorted) {
    if (r.es_aseguradora) {
      const dom = parseDomicilioAseguradora(r.aseguradora_domicilio);
      aseguradoras.push({
        requeridoId: lastRequeridoId || "orphan",
        matricula: "",
        denominacion: (r.aseguradora_nombre || "").trim(),
        cuit: "",
        domicilio: dom,
        poliza: "",
        numeroSiniestro: "",
        domicilioManual: Boolean(dom.direccion || dom.localidad || dom.provincia),
      });
      continue;
    }

    const id = r.id || newRequeridoId();
    lastRequeridoId = id;
    requeridos.push({
      id,
      nombre: r.nombre || "",
      empresa_nombre_razon_social: r.empresa_nombre_razon_social || "",
      domicilio: r.domicilio || "",
      lesiones: r.lesiones || "",
    });
  }

  if (requeridos.length === 0) {
    const id = newRequeridoId();
    requeridos.push({
      id,
      nombre: "",
      empresa_nombre_razon_social: "",
      domicilio: "",
      lesiones: "",
    });
    lastRequeridoId = id;
  }

  for (const a of aseguradoras) {
    if (a.requeridoId === "orphan") {
      a.requeridoId = requeridos[0].id;
    }
  }

  return { requeridos, aseguradoras };
}

function domicilioAseguradoraTexto(a: AseguradoraFormItem): string | null {
  const parts = [a.domicilio?.direccion, a.domicilio?.localidad, a.domicilio?.provincia]
    .map((x) => (x || "").trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Payload de requeridos para PATCH/insert (sin mediacion_id). */
export function buildRequeridosPatchPayload(
  requeridos: RequeridoForm[],
  aseguradoras: AseguradoraFormItem[]
) {
  const reqRows = requeridos
    .filter(
      (r) =>
        r.nombre.trim() ||
        r.empresa_nombre_razon_social.trim() ||
        r.domicilio.trim() ||
        r.lesiones.trim()
    )
    .map((r, i) => ({
      nombre: r.nombre.trim() || "—",
      empresa_nombre_razon_social: r.empresa_nombre_razon_social.trim() || null,
      condicion: null as string | null,
      domicilio: r.domicilio.trim() || null,
      lesiones: r.lesiones || null,
      es_aseguradora: false,
      aseguradora_nombre: null as string | null,
      aseguradora_domicilio: null as string | null,
      orden: i,
    }));

  const aseguradoraRows = aseguradoras
    .filter((a) => (a.denominacion || "").trim() !== "")
    .map((a, i) => ({
      nombre: "—",
      empresa_nombre_razon_social: null as string | null,
      condicion: null as string | null,
      domicilio: null as string | null,
      lesiones: null as string | null,
      es_aseguradora: true,
      aseguradora_nombre: a.denominacion.trim(),
      aseguradora_domicilio: domicilioAseguradoraTexto(a),
      orden: reqRows.length + i,
    }));

  return [...reqRows, ...aseguradoraRows];
}

/** Payload con mediacion_id para insert directo en Supabase (alta nueva). */
export function buildRequeridosInsertRows(
  mediacionId: string,
  requeridos: RequeridoForm[],
  aseguradoras: AseguradoraFormItem[]
) {
  return buildRequeridosPatchPayload(requeridos, aseguradoras).map((row) => ({
    mediacion_id: mediacionId,
    ...row,
  }));
}

export function empresaRequeridoPdf(r: RequeridoDbRow): string {
  const empresa = (r.empresa_nombre_razon_social || "").trim();
  if (empresa) return empresa;
  if (r.es_aseguradora && r.aseguradora_nombre) {
    return String(r.aseguradora_nombre).trim();
  }
  return "";
}

export function domicilioRequeridoPdf(r: RequeridoDbRow): string {
  const dom = (r.domicilio || "").trim();
  if (dom) return dom;
  if (r.es_aseguradora && r.aseguradora_domicilio) {
    return String(r.aseguradora_domicilio).trim();
  }
  return "";
}

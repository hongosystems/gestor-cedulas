import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest, getMediacionesRole } from "@/lib/auth-api";
import jsPDF from "jspdf";

export const runtime = "nodejs";

async function requireAdmin(
  userId: string,
  svc: ReturnType<typeof supabaseService>
) {
  const { isAdminMediaciones, isSuperadmin } = await getMediacionesRole(userId, svc);
  return isAdminMediaciones || isSuperadmin;
}

const NOMBRE_MEDIADOR = "Dr. Adrián Bustinduy";
const MATRICULA_MEDIADOR = "Mediador M.J. 1562";

function isoToDDMMAAAA(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = String(iso).substring(0, 10);
  const parts = d.split("-");
  if (parts.length !== 3) return String(iso);
  const [y, m, day] = parts;
  return `${day}/${m}/${y}`;
}

function resolveRequirentesList(mediacion: any, rows: any[]): any[] {
  if (rows && rows.length > 0) return rows;
  return [
    {
      nombre: mediacion.req_nombre,
      dni: mediacion.req_dni,
      domicilio: mediacion.req_domicilio,
      email: mediacion.req_email,
      celular: mediacion.req_celular,
    },
  ];
}

function buildFormularioMediacionPdf(mediacion: any, requeridos: any[], requirentesRows: any[]): Buffer {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const footerReservedMm = 20; // Reserva vertical para que el pie de pagina no se solape
  const usableBottom = pageHeight - margin - footerReservedMm;
  let y = margin;

  const setFont = (size: number, bold: boolean = false) => {
    doc.setFontSize(size);
    doc.setFont("times", bold ? "bold" : "normal");
  };

  const ensureSpace = (needed: number) => {
    if (y + needed > usableBottom) {
      doc.addPage();
      y = margin;
    }
  };

  const line = (text: string, bold: boolean = false, size: number = 11) => {
    setFont(size, bold);
    const maxWidth = pageWidth - 2 * margin;
    const parts = doc.splitTextToSize(text, maxWidth);
    ensureSpace(parts.length * 6 + 2);
    for (const part of parts) {
      doc.text(part, margin, y);
      y += 6;
    }
  };

  const centered = (text: string, bold: boolean = false, size: number = 14) => {
    ensureSpace(10);
    setFont(size, bold);
    doc.text(text, pageWidth / 2, y, { align: "center" });
    y += 10;
  };

  const v = (val: any) => (val === null || val === undefined ? "" : String(val));

  centered("FORMULARIO DE MEDIACION", true, 16);
  y -= 2;

  // DATOS LETRADO REQUIRENTE
  line("DATOS LETRADO REQUIRENTE", true, 12);
  line(
    `Nombre y Apellido: ${v(mediacion.letrado_nombre)}${mediacion.letrado_caracter ? ` (${v(mediacion.letrado_caracter)})` : ""}`,
    false,
    11
  );
  ensureSpace(6);
  setFont(11, false);
  doc.text(`Tomo: ${v(mediacion.letrado_tomo)}`, margin, y);
  doc.text(`Folio: ${v(mediacion.letrado_folio)}`, margin + 70, y);
  y += 6;
  line(`Domicilio: ${v(mediacion.letrado_domicilio)}`, false, 11);
  const telefonoCelular = [mediacion.letrado_telefono, mediacion.letrado_celular]
    .filter((x: any) => x !== null && x !== undefined && String(x).trim() !== "")
    .map((x: any) => String(x).trim())
    .join(" · ");
  line(`Teléfono Estudio / Celular: ${telefonoCelular || "—"}`, false, 11);
  line(`Mail: ${v(mediacion.letrado_email)}`, false, 11);
  y += 4;

  // DATOS REQUIRENTE/S
  const requirentesList = resolveRequirentesList(mediacion, requirentesRows);
  line("DATOS REQUIRENTE/S", true, 12);
  if (requirentesList.length === 1) {
    const q = requirentesList[0];
    line(`    A. Nombre y apellido del requirente: ${v(q.nombre)}`, false, 11);
    line(`    B. DNI del requirente: ${v(q.dni)}`, false, 11);
    line(`    C. Domicilio real del requirente: ${v(q.domicilio)}`, false, 11);
    line(`    D. Correo electrónico personal del requirente: ${v(q.email)}`, false, 11);
    line(`    E. Celular personal del requirente: ${v(q.celular)}`, false, 11);
  } else {
    for (let i = 0; i < requirentesList.length; i++) {
      const r = requirentesList[i] || {};
      line(`- Nombre y Apellido: ${v(r.nombre)}`, false, 11);
      y += 2;
      line(`DNI: ${v(r.dni)}`, false, 11);
      y += 2;
      line(`Domicilio real: ${v(r.domicilio)}`, false, 11);
      y += 2;
      line(`Correo electrónico personal: ${v(r.email)}`, false, 11);
      y += 2;
      line(`Celular personal: ${v(r.celular)}`, false, 11);
      y += 4;
    }
  }
  y += 4;

  // DATOS REQUERIDO/S (mismo "cantidad de cards" que el formulario)
  line("DATOS REQUERIDO/S", true, 12);
  const requeridosList = Array.isArray(requeridos) ? requeridos : [];
  const requeridosCount = Math.max(1, requeridosList.length);
  for (let i = 0; i < requeridosCount; i++) {
    const r = requeridosList[i] || {};
    line(`- Nombre y Apellido: ${v(r.nombre)}`, false, 11);
    line(`(Empresa nombre o razón social): ${v(r.empresa_nombre_razon_social)}`, false, 11);
    y += 2;
    line(`Condición: ${v(r.condicion)}`, false, 11);
    y += 2;
    line(`Domicilio: ${v(r.domicilio)}`, false, 11);
    y += 2;
    const lesionesTexto = r.lesiones == null || String(r.lesiones).trim() === "" ? "Lesiones" : String(r.lesiones);
    line(`Lesiones: ${lesionesTexto}`, false, 11);
    y += 2;
    if (r.es_aseguradora && v(r.aseguradora_nombre)) {
      line(`Aseguradora: ${v(r.aseguradora_nombre)}`, false, 11);
      if (v(r.aseguradora_domicilio)) {
        line(`Domicilio Aseguradora: ${v(r.aseguradora_domicilio)}`, false, 11);
      }
    }
    y += 4;
  }

  ensureSpace(10);
  setFont(10, false);
  // String suficientemente corto como para no salirse del ancho
  doc.text("-".repeat(80), margin, y);
  y += 8;

  // Bloque hecho/reclamo
  line(`Objeto del reclamo: ${v(mediacion.objeto_reclamo)}`, false, 11);
  line(`Fecha del Hecho: ${isoToDDMMAAAA(mediacion.fecha_hecho)}`, false, 11);
  line(`Lugar del Hecho: ${v(mediacion.lugar_hecho)}`, false, 11);
  line(`Vehiculo: ${v(mediacion.vehiculo)}`, false, 11);
  line(`(Colectivo agregar Línea e interno): ${v(mediacion.linea_interno)}`, false, 11);
  line(`Dominio: ${v(mediacion.dominio_patente)}`, false, 11);
  line(`Nº de Siniestro: ${v(mediacion.nro_siniestro)}`, false, 11);
  y += 2;
  line(`Póliza: ${v(mediacion.nro_poliza)}`, false, 11);
  y += 4;

  // Sección final
  line(`Art: ${v(mediacion.articulo)}`, false, 11);
  y += 2;
  line(`Mecánica: ${v(mediacion.mecanica_hecho)}`, false, 11);
  y += 2;
  line(`Intervino: ${v(mediacion.intervino)}`, false, 11);
  y += 2;
  line(`Lesiones de ambos: ${v(mediacion.lesiones_ambos)}`, false, 11);

  // Pie de pagina centrado (siempre al final para no romper el contenido)
  const footerY1 = usableBottom + footerReservedMm - 10;
  doc.setFontSize(12);
  doc.setFont("times", "normal");
  doc.text(NOMBRE_MEDIADOR, pageWidth / 2, footerY1, { align: "center" });
  doc.setFontSize(11);
  doc.text(MATRICULA_MEDIADOR, pageWidth / 2, footerY1 + 6, { align: "center" });

  return Buffer.from(doc.output("arraybuffer"));
}

function safeFileName(numeroTramite: string | null, mediacionId: string): string {
  if (numeroTramite && String(numeroTramite).trim()) {
    return String(numeroTramite).replace(/[/\\?*:|\s]+/g, "_").trim().slice(0, 80) + ".pdf";
  }
  return `${mediacionId}.pdf`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: mediacionId } = await params;
    const body = await req.json().catch(() => ({}));
    const tipo_plantilla = body.tipo_plantilla || "formulario_mediacion";
    const modo_firma = body.modo_firma || "sin_firma";

    const svc = supabaseService();
    if (!(await requireAdmin(user.id, svc))) {
      return NextResponse.json({ error: "Solo administradores de mediaciones" }, { status: 403 });
    }

    const { data: mediacion, error: medErr } = await svc
      .from("mediaciones")
      .select("*")
      .eq("id", mediacionId)
      .single();

    if (medErr || !mediacion) {
      return NextResponse.json({ error: "Mediación no encontrada" }, { status: 404 });
    }

    const [{ data: requeridos }, { data: requirentesRows }] = await Promise.all([
      svc.from("mediacion_requeridos").select("*").eq("mediacion_id", mediacionId).order("orden"),
      svc.from("mediacion_requirentes").select("*").eq("mediacion_id", mediacionId).order("orden"),
    ]);

    const pdfBuffer = buildFormularioMediacionPdf(mediacion, requeridos || [], requirentesRows || []);

    const fileName = safeFileName(mediacion.numero_tramite, mediacionId);
    const storagePath = `${mediacionId}/${fileName}`;

    const { error: uploadErr } = await svc.storage
      .from("mediaciones")
      .upload(storagePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadErr) {
      console.error("[mediaciones/[id]/generate-doc] upload", uploadErr);
      return NextResponse.json(
        { error: "Error al subir PDF: " + uploadErr.message },
        { status: 500 }
      );
    }

    const { data: docRow, error: insertErr } = await svc
      .from("mediacion_documentos")
      .insert({
        mediacion_id: mediacionId,
        tipo_plantilla,
        storage_path: storagePath,
        modo_firma,
      })
      .select("id, storage_path, tipo_plantilla, modo_firma, created_at")
      .single();

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    await svc.from("mediaciones").update({ estado: "doc_generado" }).eq("id", mediacionId);

    return NextResponse.json({
      ok: true,
      data: { documento_id: docRow.id, ...docRow },
    });
  } catch (e: any) {
    console.error("[mediaciones/[id]/generate-doc]", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}

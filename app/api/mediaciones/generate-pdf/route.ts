import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest, getMediacionesRole } from "@/lib/auth-api";
import jsPDF from "jspdf";

export const runtime = "nodejs";

async function canAccessMediacion(
  userId: string,
  mediacionUserId: string,
  svc: ReturnType<typeof supabaseService>
) {
  if (userId === mediacionUserId) return true;
  const { isAdminMediaciones, isSuperadmin } = await getMediacionesRole(userId, svc);
  return isAdminMediaciones || isSuperadmin;
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

function buildCartaDocumentoPdf(mediacion: any, requeridos: any[], requirentesRows: any[]): Buffer {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  let y = margin;

  const font = (size: number, bold: boolean = false) => {
    doc.setFontSize(size);
    doc.setFont("helvetica", bold ? "bold" : "normal");
  };

  font(14, true);
  doc.text("CARTA DOCUMENTO - SOLICITUD DE MEDIACIÓN", pageWidth / 2, y, { align: "center" });
  y += 12;

  font(10, false);
  const fmt = (label: string, value: string | null | undefined) => {
    if (value == null || String(value).trim() === "") return;
    doc.text(`${label}: ${String(value).trim()}`, margin, y);
    y += 6;
  };

  fmt("Nº Trámite", mediacion.numero_tramite);
  fmt("Estado", mediacion.estado);
  y += 4;

  doc.setDrawColor(200, 200, 200);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  font(11, true);
  doc.text("Letrado", margin, y);
  y += 7;
  font(10, false);
  fmt("Nombre", mediacion.letrado_nombre);
  fmt("Carácter", mediacion.letrado_caracter);
  fmt("Tomo / Folio", [mediacion.letrado_tomo, mediacion.letrado_folio].filter(Boolean).join(" - ") || undefined);
  fmt("Domicilio", mediacion.letrado_domicilio);
  fmt("Teléfono", mediacion.letrado_telefono);
  fmt("Celular", mediacion.letrado_celular);
  fmt("Email", mediacion.letrado_email);
  y += 4;

  const requirentesList = resolveRequirentesList(mediacion, requirentesRows);

  if (requirentesList.length === 1) {
    const q = requirentesList[0];
    font(11, true);
    doc.text("Requirente", margin, y);
    y += 7;
    font(10, false);
    fmt("Nombre", q.nombre);
    fmt("DNI", q.dni);
    fmt("Domicilio", q.domicilio);
    fmt("Email", q.email);
    fmt("Celular", q.celular);
    y += 4;
  } else {
    font(11, true);
    doc.text("Requirentes", margin, y);
    y += 7;
    font(10, false);
    requirentesList.forEach((q: any) => {
      fmt("Nombre", q.nombre);
      fmt("DNI", q.dni);
      fmt("Domicilio", q.domicilio);
      fmt("Email", q.email);
      fmt("Celular", q.celular);
      y += 2;
    });
    y += 4;
  }

  font(11, true);
  doc.text("Hecho", margin, y);
  y += 7;
  font(10, false);
  fmt("Objeto del reclamo", mediacion.objeto_reclamo);
  fmt("Fecha hecho", mediacion.fecha_hecho);
  fmt("Lugar", mediacion.lugar_hecho);
  fmt("Vehículo", mediacion.vehiculo);
  fmt("Dominio/Patente", mediacion.dominio_patente);
  fmt("Nº Siniestro", mediacion.nro_siniestro);
  fmt("Nº Póliza", mediacion.nro_poliza);
  fmt("Mecánica del hecho", mediacion.mecanica_hecho);
  y += 4;

  if (requeridos && requeridos.length > 0) {
    font(11, true);
    doc.text("Requeridos", margin, y);
    y += 7;
    font(10, false);
    requeridos.forEach((r: any) => {
      fmt("Nombre", r.nombre);
      fmt("Condición", r.condicion);
      fmt("Domicilio", r.domicilio);
      fmt("Lesiones", r.lesiones);
      if (r.es_aseguradora) {
        fmt("Aseguradora", r.aseguradora_nombre);
        fmt("Domicilio aseguradora", r.aseguradora_domicilio);
      }
      y += 2;
    });
  }

  const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
  return pdfBuffer;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const mediacionId = body.mediacion_id;
    const tipo_plantilla = body.tipo_plantilla || "carta_documento";
    const modo_firma = body.modo_firma || "sin_firma";

    if (!mediacionId) {
      return NextResponse.json({ error: "mediacion_id es requerido" }, { status: 400 });
    }

    const svc = supabaseService();
    const { data: mediacion, error: medErr } = await svc
      .from("mediaciones")
      .select("*")
      .eq("id", mediacionId)
      .single();

    if (medErr || !mediacion) {
      return NextResponse.json({ error: "Mediación no encontrada" }, { status: 404 });
    }

    const allowed = await canAccessMediacion(user.id, mediacion.user_id, svc);
    if (!allowed) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const [{ data: requeridos }, { data: requirentesRows }] = await Promise.all([
      svc.from("mediacion_requeridos").select("*").eq("mediacion_id", mediacionId).order("orden"),
      svc.from("mediacion_requirentes").select("*").eq("mediacion_id", mediacionId).order("orden"),
    ]);

    const pdfBuffer = buildCartaDocumentoPdf(mediacion, requeridos || [], requirentesRows || []);

    const docId = crypto.randomUUID();
    const storagePath = `${mediacion.user_id}/${mediacionId}/${docId}.pdf`;

    const { error: uploadErr } = await svc.storage
      .from("mediaciones")
      .upload(storagePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadErr) {
      console.error("[mediaciones/generate-pdf] upload", uploadErr);
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
    console.error("[mediaciones/generate-pdf]", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}

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

const REMITENTE = "Dr. Adrián Bustinduy — Paraná 785 4° Piso B, CABA (1017)";
const NOMBRE_MEDIADOR = "Dr. Adrián Bustinduy";

const TEXTO_MEDIACION_PREJUDICIAL =
  "Por la presente se realiza la presente solicitud de mediación prejudicial obligatoria en los términos de la Ley 26.589 y normas complementarias. " +
  "Se requiere la designación de fecha de audiencia a los efectos de intentar un acuerdo que evite la vía judicial.";

function buildCartaDocumentoPdf(mediacion: any, requeridos: any[]): Buffer {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  let y = margin;

  const font = (size: number, bold: boolean = false) => {
    doc.setFontSize(size);
    doc.setFont("helvetica", bold ? "bold" : "normal");
  };

  // ——— Encabezado ———
  font(16, true);
  doc.text("CARTA DOCUMENTO", pageWidth / 2, y, { align: "center" });
  y += 14;

  font(9, false);
  doc.text(`Nº Trámite: ${mediacion.numero_tramite || "—"}`, margin, y);
  y += 8;

  // ——— Remitente ———
  font(10, true);
  doc.text("Remitente:", margin, y);
  y += 6;
  font(10, false);
  doc.text(REMITENTE, margin, y);
  y += 10;

  // ——— Destinatario (primer requerido) ———
  font(10, true);
  doc.text("Destinatario:", margin, y);
  y += 6;
  font(10, false);
  const primerRequerido = requeridos && requeridos[0];
  if (primerRequerido) {
    doc.text(primerRequerido.nombre || "—", margin, y);
    y += 6;
    if (primerRequerido.domicilio && String(primerRequerido.domicilio).trim()) {
      doc.text(String(primerRequerido.domicilio).trim(), margin, y);
      y += 6;
    }
    if (primerRequerido.condicion && String(primerRequerido.condicion).trim()) {
      doc.text(`Condición: ${String(primerRequerido.condicion).trim()}`, margin, y);
      y += 6;
    }
  } else {
    doc.text("—", margin, y);
    y += 6;
  }
  y += 8;

  // ——— Cuerpo: mediación prejudicial, Ley 26.589, tipo de reclamo, fecha y lugar ———
  font(10, true);
  doc.text("Cuerpo:", margin, y);
  y += 6;
  font(10, false);
  const lineHeight = 6;
  const maxWidth = pageWidth - 2 * margin;
  const parrafos: string[] = [
    TEXTO_MEDIACION_PREJUDICIAL,
    `Tipo de reclamo: ${mediacion.objeto_reclamo || "—"}.`,
    `Fecha del hecho: ${mediacion.fecha_hecho || "—"}.`,
    `Lugar del hecho: ${mediacion.lugar_hecho || "—"}.`,
  ];
  for (const str of parrafos) {
    const lines = doc.splitTextToSize(str, maxWidth);
    for (const line of lines) {
      if (y > pageHeight - 35) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y);
      y += lineHeight;
    }
    y += 2;
  }
  y += 8;

  // ——— Pie: línea de firma con nombre del mediador ———
  if (y > pageHeight - 40) {
    doc.addPage();
    y = margin;
  }
  doc.setDrawColor(0, 0, 0);
  doc.line(margin, y, margin + 60, y);
  y += 2;
  font(9, false);
  doc.text(NOMBRE_MEDIADOR, margin, y);
  y += 4;
  doc.text("Mediador", margin, y);

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
    const tipo_plantilla = body.tipo_plantilla || "carta_documento";
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

    const { data: requeridos } = await svc
      .from("mediacion_requeridos")
      .select("*")
      .eq("mediacion_id", mediacionId)
      .order("orden");

    const pdfBuffer = buildCartaDocumentoPdf(mediacion, requeridos || []);

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
      data: { documento_id: docRow.id, storage_path: docRow.storage_path, ...docRow },
    });
  } catch (e: any) {
    console.error("[mediaciones/[id]/generate-doc]", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}

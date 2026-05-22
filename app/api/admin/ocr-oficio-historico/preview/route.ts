import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest } from "@/lib/auth-api";
import {
  STORAGE_BUCKET,
  MOTIVO_BUG_SLUG,
  fetchCandidatosOcrOficioHistorico,
  requireSuperadmin,
} from "@/lib/ocr-oficio-historico";

export const runtime = "nodejs";
export const maxDuration = 120;

const MUESTRA_MAX = 50;
const STORAGE_CHECK_CONCURRENCY = 8;

type MuestraItem = {
  id: string;
  pdf_path: string | null;
  ocr_exp_nro: string | null;
  juzgado: string | null;
  caratula: string | null;
  pjn_cargado_at: string | null;
  pdf_descargable: boolean;
};

type ErrorDescarga = {
  id: string;
  pdf_path: string | null;
  error: string;
};

async function verificarPdfEnStorage(
  svc: ReturnType<typeof supabaseService>,
  pdfPath: string
): Promise<{ ok: boolean; error: string | null }> {
  const { data, error } = await svc.storage.from(STORAGE_BUCKET).download(pdfPath);

  if (error) {
    return { ok: false, error: error.message };
  }

  if (!data || (data.size ?? 0) <= 0) {
    return { ok: false, error: "Archivo vacío o no encontrado" };
  }

  return { ok: true, error: null };
}

async function verificarLote(
  svc: ReturnType<typeof supabaseService>,
  items: { id: string; pdf_path: string | null }[]
): Promise<Map<string, { ok: boolean; error: string | null }>> {
  const resultados = new Map<string, { ok: boolean; error: string | null }>();

  for (let i = 0; i < items.length; i += STORAGE_CHECK_CONCURRENCY) {
    const lote = items.slice(i, i + STORAGE_CHECK_CONCURRENCY);
    const checks = await Promise.all(
      lote.map(async (item) => {
        const path = item.pdf_path?.trim();
        if (!path) {
          return { id: item.id, ok: false, error: "pdf_path vacío en base de datos" };
        }
        const verificacion = await verificarPdfEnStorage(svc, path);
        return { id: item.id, ...verificacion };
      })
    );
    for (const check of checks) {
      resultados.set(check.id, { ok: check.ok, error: check.error });
    }
  }

  return resultados;
}

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = supabaseService();
  if (!(await requireSuperadmin(user.id, svc))) {
    return NextResponse.json(
      { error: "Solo superadmin puede consultar el preview de OCR oficio histórico" },
      { status: 403 }
    );
  }

  const railwayOcrUrl = process.env.RAILWAY_OCR_URL?.trim() || null;
  const extractorPlaneado = railwayOcrUrl
    ? `POST ${railwayOcrUrl.replace(/\/$/, "")}/procesar-oficio`
    : null;

  console.log("[ocr-oficio-historico/preview] Inicio dry-run", { userId: user.id });

  const fetchResult = await fetchCandidatosOcrOficioHistorico(svc);
  if (!fetchResult.ok) {
    return NextResponse.json(
      { error: fetchResult.error, details: fetchResult.details },
      { status: 500 }
    );
  }

  const candidatos = fetchResult.candidatos;

  if (candidatos.length === 0) {
    return NextResponse.json({
      ok: true,
      modo: "dry_run",
      generated_at: new Date().toISOString(),
      nota: "No se encontraron candidatos con el criterio del universo histórico.",
      criterio: {
        tipo_documento: "OFICIO",
        estado_ocr: "listo",
        pjn_cargado_at: "NOT NULL",
        ocr_destinatario: "vacío",
        audit: {
          tipo_documento_nuevo: "OFICIO",
          aplicado_at: "NOT NULL",
          revertido_at: "NULL",
          motivo: `slug ${MOTIVO_BUG_SLUG} o texto similar`,
        },
      },
      extractor_planeado: extractorPlaneado,
      total: 0,
      con_pdf_descargable: 0,
      sin_pdf_descargable: 0,
      errores_descarga: [],
      muestra: [],
    });
  }

  const verificaciones = await verificarLote(svc, candidatos);

  let conPdfDescargable = 0;
  let sinPdfDescargable = 0;
  const erroresDescarga: ErrorDescarga[] = [];
  const muestraCompleta: MuestraItem[] = [];

  for (const c of candidatos) {
    const ver = verificaciones.get(c.id);
    const pdfDescargable = ver?.ok === true;

    if (pdfDescargable) {
      conPdfDescargable++;
    } else {
      sinPdfDescargable++;
      erroresDescarga.push({
        id: c.id,
        pdf_path: c.pdf_path,
        error: ver?.error || "No se pudo verificar el PDF en storage",
      });
    }

    muestraCompleta.push({
      id: c.id,
      pdf_path: c.pdf_path,
      ocr_exp_nro: c.ocr_exp_nro,
      juzgado: c.juzgado,
      caratula: c.caratula?.trim() || c.ocr_caratula?.trim() || null,
      pjn_cargado_at: c.pjn_cargado_at,
      pdf_descargable: pdfDescargable,
    });
  }

  const muestra = muestraCompleta.slice(0, MUESTRA_MAX);

  return NextResponse.json({
    ok: true,
    modo: "dry_run",
    generated_at: new Date().toISOString(),
    nota: "Solo verificación. No se ejecutó OCR ni se modificó cedulas.",
    criterio: {
      tipo_documento: "OFICIO",
      estado_ocr: "listo",
      pjn_cargado_at: "NOT NULL",
      ocr_destinatario: "vacío (NULL o string vacío)",
      audit: {
        tipo_documento_nuevo: "OFICIO",
        aplicado_at: "NOT NULL",
        revertido_at: "NULL",
        motivo: `slug ${MOTIVO_BUG_SLUG} o texto similar (bug histórico cedula→oficio)`,
      },
      storage: {
        bucket: STORAGE_BUCKET,
        path_field: "cedulas.pdf_path",
      },
    },
    extractor_planeado: extractorPlaneado,
    campos_ocr_a_completar_en_run: [
      "ocr_destinatario",
      "ocr_exp_nro (solo si vacío)",
      "ocr_caratula (solo si vacío)",
    ],
    total: candidatos.length,
    con_pdf_descargable: conPdfDescargable,
    sin_pdf_descargable: sinPdfDescargable,
    errores_descarga: erroresDescarga,
    muestra,
  });
}

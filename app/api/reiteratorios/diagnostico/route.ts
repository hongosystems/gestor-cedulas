import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest } from "@/lib/auth-api";

export const runtime = "nodejs";

const MUESTRA_MAX = 10;
const DIAS_UI_DEFAULT = 14;

type CedulaDiag = {
  id: string;
  tipo_documento: string | null;
  estado_ocr: string | null;
  pjn_cargado_at: string | null;
  ocr_exp_nro: string | null;
  ocr_caratula: string | null;
  juzgado: string | null;
  caratula: string | null;
  fecha_carga: string | null;
};

type FavoritoDiag = {
  id: string;
  jurisdiccion: string;
  numero: string;
  anio: number;
  movimientos: unknown;
  fecha_ultima_carga: string | null;
};

type MuestraRow = {
  id: string;
  ocr_exp_nro: string | null;
  tipo_documento: string | null;
  estado_ocr: string | null;
  pjn_cargado_at: string | null;
  juzgado: string | null;
  motivo: string;
  dias_desde_carga?: number;
  match_favorito?: boolean;
  tiene_movimientos?: boolean;
};

function diasDesde(iso: string): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  const diffMs = Date.now() - then;
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function parseExpedienteFromOcr(ocrExpNro: string | null): {
  numero: string | null;
  anio: number | null;
} {
  if (!ocrExpNro?.trim()) return { numero: null, anio: null };
  const parts = ocrExpNro.trim().split("/");
  if (parts.length < 2) return { numero: null, anio: null };
  const numero = parts[0]?.trim() || null;
  const anio = parseInt(parts[1]?.trim() ?? "", 10);
  return { numero, anio: Number.isNaN(anio) ? null : anio };
}

function favoritoKey(numero: string, anio: number): string {
  return `${numero}|${anio}`;
}

function toMuestra(
  row: CedulaDiag,
  motivo: string,
  extra?: Partial<MuestraRow>
): MuestraRow {
  return {
    id: row.id,
    ocr_exp_nro: row.ocr_exp_nro,
    tipo_documento: row.tipo_documento,
    estado_ocr: row.estado_ocr,
    pjn_cargado_at: row.pjn_cargado_at,
    juzgado: row.juzgado,
    motivo,
    ...extra,
  };
}

function capMuestra<T>(arr: T[], max = MUESTRA_MAX): T[] {
  return arr.slice(0, max);
}

async function requireSuperadmin(
  userId: string,
  svc: ReturnType<typeof supabaseService>
): Promise<boolean> {
  const { data } = await svc
    .from("user_roles")
    .select("is_superadmin")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.is_superadmin === true;
}

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = supabaseService();
  if (!(await requireSuperadmin(user.id, svc))) {
    return NextResponse.json(
      { error: "Solo superadmin puede consultar el diagnóstico de reiteratorios" },
      { status: 403 }
    );
  }

  const diasParam = req.nextUrl.searchParams.get("dias");
  const umbralDias = diasParam ? Math.max(0, parseInt(diasParam, 10) || DIAS_UI_DEFAULT) : DIAS_UI_DEFAULT;

  console.log("[reiteratorios/diagnostico] Inicio auditoría", {
    userId: user.id,
    umbralDias,
  });

  const selectFields =
    "id, tipo_documento, estado_ocr, pjn_cargado_at, ocr_exp_nro, ocr_caratula, juzgado, caratula, fecha_carga";

  const { data: todasCedulas, error: todasErr } = await svc
    .from("cedulas")
    .select(selectFields);

  if (todasErr) {
    console.error("[reiteratorios/diagnostico] Error leyendo cedulas:", todasErr.message);
    return NextResponse.json(
      { error: "Error al leer cédulas", details: todasErr.message },
      { status: 500 }
    );
  }

  const rows = (todasCedulas ?? []) as CedulaDiag[];
  console.log("[reiteratorios/diagnostico] Total filas cedulas:", rows.length);

  const porTipo = {
    OFICIO: 0,
    CEDULA: 0,
    OTROS: 0,
    NULL: 0,
  };
  for (const r of rows) {
    const t = r.tipo_documento;
    if (t === "OFICIO") porTipo.OFICIO++;
    else if (t === "CEDULA") porTipo.CEDULA++;
    else if (t == null) porTipo.NULL++;
    else porTipo.OTROS++;
  }
  console.log("[reiteratorios/diagnostico] Por tipo_documento:", porTipo);

  const oficios = rows.filter((r) => r.tipo_documento === "OFICIO");
  const oficiosOcrListo = oficios.filter((r) => r.estado_ocr === "listo");
  const oficiosCargadosPjn = oficiosOcrListo.filter((r) => r.pjn_cargado_at != null);

  const oficiosConDias = oficiosCargadosPjn.map((r) => ({
    row: r,
    dias: diasDesde(r.pjn_cargado_at!),
  }));

  const criterioUiActual = oficiosConDias.filter((x) => x.dias >= umbralDias);

  console.log("[reiteratorios/diagnostico] Pipeline OFICIO:", {
    oficios: oficios.length,
    ocr_listo: oficiosOcrListo.length,
    pjn_cargado: oficiosCargadosPjn.length,
    con_umbral_dias: criterioUiActual.length,
    umbralDias,
  });

  const { data: favoritosData, error: favErr } = await svc
    .from("pjn_favoritos")
    .select("id, jurisdiccion, numero, anio, movimientos, fecha_ultima_carga");

  if (favErr) {
    console.error("[reiteratorios/diagnostico] Error leyendo pjn_favoritos:", favErr.message);
    return NextResponse.json(
      { error: "Error al leer pjn_favoritos", details: favErr.message },
      { status: 500 }
    );
  }

  const favoritos = (favoritosData ?? []) as FavoritoDiag[];
  const favoritosByKey = new Map<string, FavoritoDiag>();
  for (const f of favoritos) {
    favoritosByKey.set(favoritoKey(f.numero, f.anio), f);
    const numSinCeros = f.numero.replace(/^0+/, "") || f.numero;
    if (numSinCeros !== f.numero) {
      favoritosByKey.set(favoritoKey(numSinCeros, f.anio), f);
    }
  }
  console.log("[reiteratorios/diagnostico] Favoritos cargados:", favoritos.length);

  function resolveFavorito(row: CedulaDiag): {
    fav?: FavoritoDiag;
    tieneMatch: boolean;
    tieneMovs: boolean;
  } {
    const { numero, anio } = parseExpedienteFromOcr(row.ocr_exp_nro);
    let fav: FavoritoDiag | undefined;
    if (numero != null && anio != null) {
      fav =
        favoritosByKey.get(favoritoKey(numero, anio)) ??
        favoritosByKey.get(favoritoKey(numero.replace(/^0+/, "") || numero, anio));
    }
    const tieneMatch = !!fav;
    const tieneMovs =
      tieneMatch &&
      fav!.movimientos != null &&
      (Array.isArray(fav!.movimientos)
        ? fav!.movimientos.length > 0
        : typeof fav!.movimientos === "object");
    return { fav, tieneMatch, tieneMovs };
  }

  let conMatchFavorito = 0;
  let conMovimientos = 0;
  const sinFavorito: MuestraRow[] = [];
  const sinMovimientos: MuestraRow[] = [];
  const excluidosPor14Dias: MuestraRow[] = [];

  for (const row of oficiosCargadosPjn) {
    const dias = diasDesde(row.pjn_cargado_at!);
    const { tieneMatch, tieneMovs } = resolveFavorito(row);

    if (tieneMatch) conMatchFavorito++;
    if (tieneMovs) conMovimientos++;

    if (!tieneMatch) {
      sinFavorito.push(
        toMuestra(row, "Sin match en pjn_favoritos (numero/anio)", {
          dias_desde_carga: dias,
        })
      );
    } else if (!tieneMovs) {
      sinMovimientos.push(
        toMuestra(row, "Match favorito pero sin movimientos JSON", {
          dias_desde_carga: dias,
          match_favorito: true,
          tiene_movimientos: false,
        })
      );
    }
  }

  for (const { row, dias } of oficiosConDias) {
    const { tieneMatch, tieneMovs } = resolveFavorito(row);
    if (dias < umbralDias) {
      excluidosPor14Dias.push(
        toMuestra(row, `Menos de ${umbralDias} días desde pjn_cargado_at`, {
          dias_desde_carga: dias,
          match_favorito: tieneMatch,
          tiene_movimientos: tieneMovs,
        })
      );
    }
  }

  const excluidosTipo: MuestraRow[] = [];
  const excluidosEstadoOcr: MuestraRow[] = [];
  const excluidosSinPjn: MuestraRow[] = [];

  for (const r of rows) {
    if (r.tipo_documento === "OFICIO") continue;

    const pareceOficioPipeline =
      r.pjn_cargado_at != null ||
      r.estado_ocr === "listo" ||
      (r.ocr_exp_nro?.trim()?.length ?? 0) > 0;

    if (!pareceOficioPipeline) continue;

    excluidosTipo.push(
      toMuestra(r, `tipo_documento=${r.tipo_documento ?? "NULL"} (no OFICIO)`)
    );
  }

  for (const r of oficios) {
    if (r.estado_ocr === "listo") continue;
    excluidosEstadoOcr.push(
      toMuestra(r, `estado_ocr=${r.estado_ocr ?? "NULL"} (requiere listo)`)
    );
  }

  for (const r of oficiosOcrListo) {
    if (r.pjn_cargado_at != null) continue;
    excluidosSinPjn.push(
      toMuestra(r, "pjn_cargado_at NULL (no figura como cargado en PJN)")
    );
  }

  const conteos = {
    total_cedulas: rows.length,
    por_tipo_documento: porTipo,
    etapa_oficios_tipo_OFICIO: oficios.length,
    etapa_oficios_estado_ocr_listo: oficiosOcrListo.length,
    etapa_oficios_cargados_pjn: oficiosCargadosPjn.length,
    etapa_con_dias_umbral: criterioUiActual.length,
    etapa_criterio_ui_actual: criterioUiActual.length,
    etapa_con_match_pjn_favoritos: conMatchFavorito,
    etapa_con_movimientos_pjn: conMovimientos,
    perdidos_entre_carga_y_ui_por_dias:
      oficiosCargadosPjn.length - criterioUiActual.length,
    perdidos_sin_favorito_en_cargados_pjn: oficiosCargadosPjn.length - conMatchFavorito,
    perdidos_sin_movimientos_en_cargados_pjn: oficiosCargadosPjn.length - conMovimientos,
  };

  console.log("[reiteratorios/diagnostico] Conteos finales:", conteos);
  console.log("[reiteratorios/diagnostico] Exclusiones:", {
    por_tipo: excluidosTipo.length,
    por_estado_ocr: excluidosEstadoOcr.length,
    sin_pjn_cargado_at: excluidosSinPjn.length,
    menos_de_umbral_dias: excluidosPor14Dias.length,
    sin_favorito_muestra: sinFavorito.length,
    sin_movimientos_muestra: sinMovimientos.length,
  });

  const { data: syncMeta } = await svc
    .from("pjn_sync_metadata")
    .select("last_sync_at")
    .eq("id", "00000000-0000-0000-0000-000000000001")
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    generated_at: new Date().toISOString(),
    nota:
      "Auditoría de diagnóstico. No modifica el listado ni las reglas de /reiteratorios.",
    criterio_ui_actual: {
      tipo_documento: "OFICIO",
      estado_ocr: "listo",
      pjn_cargado_at: "NOT NULL",
      dias_desde_pjn_cargado_at_min: umbralDias,
      fuente: "app/reiteratorios/page.tsx (misma lógica, umbral configurable por ?dias=)",
    },
    pjn_sync: {
      last_sync_at: syncMeta?.last_sync_at ?? null,
    },
    conteos,
    pipeline: [
      {
        etapa: "1_criterio_ui_actual",
        descripcion: "OFICIO + OCR listo + pjn_cargado_at + días >= umbral",
        count: conteos.etapa_criterio_ui_actual,
      },
      {
        etapa: "2_oficios_cargados_pjn",
        descripcion: "OFICIO + OCR listo + pjn_cargado_at (sin filtro de días)",
        count: conteos.etapa_oficios_cargados_pjn,
      },
      {
        etapa: "3_con_dias_umbral",
        descripcion: `Igual a UI: días desde pjn_cargado_at >= ${umbralDias}`,
        count: conteos.etapa_con_dias_umbral,
      },
      {
        etapa: "4_match_pjn_favoritos",
        descripcion: "Subconjunto cargados PJN con match numero/anio en pjn_favoritos",
        count: conteos.etapa_con_match_pjn_favoritos,
      },
      {
        etapa: "5_movimientos_pjn_disponibles",
        descripcion: "Subconjunto con match y movimientos no vacíos en favorito",
        count: conteos.etapa_con_movimientos_pjn,
      },
    ],
    exclusiones: {
      por_tipo_documento_no_oficio: {
        count: excluidosTipo.length,
        descripcion:
          "Filas no OFICIO con señales de pipeline (pjn_cargado, OCR listo o ocr_exp_nro)",
        muestra: capMuestra(excluidosTipo),
      },
      por_estado_ocr_distinto_listo: {
        count: excluidosEstadoOcr.length,
        descripcion: "OFICIO con estado_ocr != listo",
        muestra: capMuestra(excluidosEstadoOcr),
      },
      sin_pjn_cargado_at: {
        count: excluidosSinPjn.length,
        descripcion: "OFICIO + OCR listo sin pjn_cargado_at",
        muestra: capMuestra(excluidosSinPjn),
      },
      excluidos_por_umbral_dias: {
        count: excluidosPor14Dias.length,
        descripcion: `Cargados PJN con menos de ${umbralDias} días (no aparecen en UI)`,
        muestra: capMuestra(excluidosPor14Dias),
      },
    },
    muestras_adicionales: {
      cargados_pjn_sin_favorito: capMuestra(sinFavorito),
      match_favorito_sin_movimientos: capMuestra(sinMovimientos),
      criterio_ui_ids: capMuestra(
        criterioUiActual.map(({ row, dias }) => {
          const { tieneMatch, tieneMovs } = resolveFavorito(row);
          return toMuestra(row, "Incluido en criterio UI actual", {
            dias_desde_carga: dias,
            match_favorito: tieneMatch,
            tiene_movimientos: tieneMovs,
          });
        }),
        20
      ),
    },
  });
}

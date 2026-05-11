import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";

export const runtime = "nodejs";

type NotifRow = {
  id: string;
  user_id: string;
  thread_id: string | null;
  expediente_id: string | null;
  is_pjn_favorito: boolean | null;
  link: string | null;
  title: string | null;
  body: string | null;
  nota_context: string | null;
  metadata: Record<string, any> | string | null;
};

type ResolvedInfo = {
  caratula: string | null;
  juzgado: string | null;
  numero: string | null;
  source: string;
};

async function getUserFromRequest(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;

  try {
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return null;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    if (!url || !anon) return null;

    const { createClient } = await import("@supabase/supabase-js");
    const supabaseClient = createClient(url, anon, {
      auth: { persistSession: false },
    });

    const { data: { user }, error } = await supabaseClient.auth.getUser(token);
    if (error || !user) return null;
    return user;
  } catch {
    return null;
  }
}

function asObject(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (typeof value === "object") return value as Record<string, any>;
  return {};
}

function isUuidLike(value: string | null | undefined) {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function stripLeadingZeros(value: string | null | undefined) {
  if (!value) return "";
  return value.replace(/^0+/, "") || "0";
}

function parsePjnCaseKey(raw: string | null | undefined): { jurisdiccion: string; numero: string; anio: number } | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const match = trimmed.match(/^([A-Z]{2,6})\s+0*([0-9]+)\/([0-9]{4})$/i);
  if (!match) return null;
  return {
    jurisdiccion: match[1].toUpperCase(),
    numero: String(Number(match[2])),
    anio: Number(match[3]),
  };
}

function parseLink(link: string | null | undefined) {
  if (!link) return { cedulaId: null, pjnRef: null, ordenId: null, expedienteRef: null };
  const cedulaMatch = link.match(/^\/app#([a-f0-9-]+)$/i);
  const pjnMatch = link.match(/#pjn_(.+)$/i);
  const expHashMatch = link.match(/#([a-f0-9-]+)$/i);
  const ordenIdMatch = link.match(/[?&]orden_id=([^&#]+)/i);
  return {
    cedulaId: cedulaMatch?.[1] || null,
    pjnRef: pjnMatch?.[1] || null,
    ordenId: ordenIdMatch?.[1] || null,
    expedienteRef: expHashMatch?.[1] || null,
  };
}

async function resolveFromOrdenId(svc: ReturnType<typeof supabaseService>, ordenId: string): Promise<ResolvedInfo | null> {
  const { data: orden } = await svc
    .from("ordenes_medicas")
    .select(`
      case_ref,
      expediente_id,
      expedientes:expediente_id (
        caratula,
        juzgado,
        numero_expediente
      )
    `)
    .eq("id", ordenId)
    .maybeSingle();

  if (!orden) return null;
  const rel = (orden as any).expedientes;
  if (rel) {
    return {
      caratula: rel.caratula || null,
      juzgado: rel.juzgado || null,
      numero: rel.numero_expediente || null,
      source: "ordenes_medicas.expediente",
    };
  }
  if ((orden as any).case_ref) {
    return {
      caratula: (orden as any).case_ref,
      juzgado: null,
      numero: (orden as any).case_ref,
      source: "ordenes_medicas.case_ref",
    };
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { notification_id, thread_id } = await req.json();
    if (!notification_id && !thread_id) {
      return NextResponse.json({ error: "notification_id o thread_id requerido" }, { status: 400 });
    }

    const svc = supabaseService();

    // Validar acceso del usuario al hilo/notificacion.
    let accessQuery = svc
      .from("notifications")
      .select("id, thread_id")
      .eq("user_id", user.id)
      .limit(1);

    if (notification_id) {
      accessQuery = accessQuery.eq("id", notification_id);
    } else {
      accessQuery = accessQuery.eq("thread_id", thread_id);
    }

    const { data: accessNotif } = await accessQuery.maybeSingle();
    if (!accessNotif) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const effectiveThreadId = thread_id || (accessNotif as any).thread_id || null;

    let rows: NotifRow[] = [];
    if (effectiveThreadId) {
      const { data } = await svc
        .from("notifications")
        .select("id, user_id, thread_id, expediente_id, is_pjn_favorito, link, title, body, nota_context, metadata")
        .eq("thread_id", effectiveThreadId)
        .order("created_at", { ascending: true });
      rows = (data || []) as NotifRow[];
    } else if (notification_id) {
      const { data } = await svc
        .from("notifications")
        .select("id, user_id, thread_id, expediente_id, is_pjn_favorito, link, title, body, nota_context, metadata")
        .eq("id", notification_id)
        .limit(1);
      rows = (data || []) as NotifRow[];
    }

    if (!rows.length) {
      return NextResponse.json({ ok: true, data: null });
    }

    const metadataList = rows.map((r) => asObject(r.metadata));
    const mergedText = rows.map((r) => `${r.title || ""}\n${r.body || ""}\n${r.nota_context || ""}`).join("\n");

    // 1) metadata directa con datos utiles
    const metaWithInfo = metadataList.find((m) => m.caratula || m.juzgado || m.numero);
    if (metaWithInfo) {
      return NextResponse.json({
        ok: true,
        data: {
          caratula: metaWithInfo.caratula || null,
          juzgado: metaWithInfo.juzgado || null,
          numero: metaWithInfo.numero || null,
          source: "metadata.directa",
        },
      });
    }

    // 2) orden_id en metadata/link
    const ordenId = metadataList.map((m) => m.orden_id).find(Boolean)
      || rows.map((r) => parseLink(r.link).ordenId).find(Boolean);
    if (ordenId) {
      const info = await resolveFromOrdenId(svc, String(ordenId));
      if (info) return NextResponse.json({ ok: true, data: info });
    }

    // 3) cedula_id
    const cedulaId = metadataList.map((m) => m.cedula_id).find(Boolean)
      || rows.map((r) => parseLink(r.link).cedulaId).find(Boolean);
    if (cedulaId) {
      const { data: cedula } = await svc
        .from("cedulas")
        .select("caratula, juzgado")
        .eq("id", String(cedulaId))
        .maybeSingle();
      if (cedula) {
        return NextResponse.json({
          ok: true,
          data: {
            caratula: (cedula as any).caratula || null,
            juzgado: (cedula as any).juzgado || null,
            numero: null,
            source: "cedulas.id",
          },
        });
      }
    }

    // 4) expediente_id directo / expediente_ref
    const expedienteCandidate = rows.map((r) => r.expediente_id).find(Boolean)
      || metadataList.map((m) => m.expediente_ref).find(Boolean)
      || rows.map((r) => parseLink(r.link).expedienteRef).find(Boolean);

    if (expedienteCandidate) {
      const expVal = String(expedienteCandidate);
      if (isUuidLike(expVal)) {
        const { data: exp } = await svc
          .from("expedientes")
          .select("caratula, juzgado, numero_expediente")
          .eq("id", expVal)
          .maybeSingle();
        if (exp) {
          return NextResponse.json({
            ok: true,
            data: {
              caratula: (exp as any).caratula || null,
              juzgado: (exp as any).juzgado || null,
              numero: (exp as any).numero_expediente || null,
              source: "expedientes.id",
            },
          });
        }
      } else {
        const numeroSinCeros = stripLeadingZeros(expVal);
        const { data: exp } = await svc
          .from("expedientes")
          .select("caratula, juzgado, numero_expediente")
          .ilike("numero_expediente", `%${numeroSinCeros}%`)
          .limit(1)
          .maybeSingle();
        if (exp) {
          return NextResponse.json({
            ok: true,
            data: {
              caratula: (exp as any).caratula || null,
              juzgado: (exp as any).juzgado || null,
              numero: (exp as any).numero_expediente || null,
              source: "expedientes.numero",
            },
          });
        }
      }
    }

    // 5) PJN por referencia en link/metadata
    const pjnRef = rows.map((r) => parseLink(r.link).pjnRef).find(Boolean)
      || metadataList.map((m) => m.expediente_ref).find((v) => typeof v === "string" && /[A-Z]{2,6}\s+\d+\/\d{4}/i.test(v || ""));
    if (pjnRef) {
      const parsed = parsePjnCaseKey(String(pjnRef));
      if (parsed) {
        let { data: pjnFav } = await svc
          .from("pjn_favoritos")
          .select("caratula, juzgado, numero")
          .eq("jurisdiccion", parsed.jurisdiccion)
          .eq("anio", parsed.anio)
          .eq("numero", parsed.numero)
          .maybeSingle();
        if (!pjnFav) {
          const retry = await svc
            .from("pjn_favoritos")
            .select("caratula, juzgado, numero")
            .eq("jurisdiccion", parsed.jurisdiccion)
            .eq("anio", parsed.anio)
            .eq("numero", parsed.numero.padStart(6, "0"))
            .maybeSingle();
          pjnFav = retry.data;
        }
        if (pjnFav) {
          return NextResponse.json({
            ok: true,
            data: {
              caratula: (pjnFav as any).caratula || null,
              juzgado: (pjnFav as any).juzgado || null,
              numero: (pjnFav as any).numero || null,
              source: "pjn_favoritos",
            },
          });
        }
      }
    }

    // 6) Parsear numero de expediente desde texto y buscar por numero_expediente.
    const numeroMatch = mergedText.match(/\b(\d{1,7})\s*\/\s*(\d{4})\b/);
    if (numeroMatch) {
      const numeroRaw = numeroMatch[1];
      const anio = numeroMatch[2];
      const numeroNormalizado = `${stripLeadingZeros(numeroRaw)}/${anio}`;
      const numeroConCeros = `${numeroRaw.padStart(6, "0")}/${anio}`;

      let { data: exp } = await svc
        .from("expedientes")
        .select("caratula, juzgado, numero_expediente")
        .ilike("numero_expediente", `%${numeroNormalizado}%`)
        .limit(1)
        .maybeSingle();

      if (!exp) {
        const retry = await svc
          .from("expedientes")
          .select("caratula, juzgado, numero_expediente")
          .ilike("numero_expediente", `%${numeroConCeros}%`)
          .limit(1)
          .maybeSingle();
        exp = retry.data;
      }

      if (exp) {
        return NextResponse.json({
          ok: true,
          data: {
            caratula: (exp as any).caratula || null,
            juzgado: (exp as any).juzgado || null,
            numero: (exp as any).numero_expediente || null,
            source: "expedientes.numero_texto",
          },
        });
      }
    }

    return NextResponse.json({ ok: true, data: null });
  } catch (e: any) {
    console.error("[notifications/context] error:", e);
    return NextResponse.json({ error: e?.message || "Error desconocido" }, { status: 500 });
  }
}

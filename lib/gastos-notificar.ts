import type { supabaseService } from "@/lib/supabase-server";

type Svc = ReturnType<typeof supabaseService>;

const FALLBACK_NOTIFY_IDS = [
  "35a96627-1c5c-49be-b79a-81d8f9ba8396", // Francisco Querinuzzi
  "90b5283f-27bf-4494-8562-be631f9b42f7", // Gustavo Hisi
  "6bda05cd-4223-4dc3-9320-ab6571e43763", // Jorge Ifran
];

export async function resolveGastosDestinatarios(svc: Svc): Promise<string[]> {
  const envRaw = process.env.GASTOS_BANDEJA_DESTINATARIOS || "";
  const emails = envRaw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const ids = new Set<string>();

  for (const email of emails) {
    const { data: profile } = await svc
      .from("profiles")
      .select("id")
      .ilike("email", email)
      .maybeSingle();
    if (profile?.id) {
      ids.add(profile.id);
    } else {
      console.warn(`[gastos/notificar] Usuario no encontrado para email: ${email}`);
    }
  }

  if (ids.size === 0) {
    for (const id of FALLBACK_NOTIFY_IDS) ids.add(id);
  }

  return Array.from(ids);
}

export async function notificarGastoAnticipo(
  svc: Svc,
  gastoId: string,
  options?: { force?: boolean }
): Promise<{ ok: boolean; notificados: number; reason?: string }> {
  const { data: gasto, error } = await svc
    .from("gastos_anticipo")
    .select("*")
    .eq("id", gastoId)
    .maybeSingle();

  if (error || !gasto) {
    return { ok: false, notificados: 0, reason: "gasto_no_encontrado" };
  }

  if (!options?.force && gasto.estado !== "NUEVO") {
    return { ok: true, notificados: 0, reason: "ya_notificado" };
  }

  const destinatarios = await resolveGastosDestinatarios(svc);
  if (destinatarios.length === 0) {
    return { ok: false, notificados: 0, reason: "sin_destinatarios" };
  }

  const expedienteLabel = gasto.jurisdiccion
    ? `${gasto.jurisdiccion} ${String(gasto.numero).padStart(6, "0")}/${gasto.anio}`
    : `${gasto.numero}/${gasto.anio}`;

  const montoStr =
    gasto.monto != null
      ? `$${Number(gasto.monto).toLocaleString("es-AR")}`
      : "monto pendiente";

  let pdfSignedUrl: string | null = null;
  if (gasto.pdf_storage_path) {
    const { data: signed } = await svc.storage
      .from("gastos-pericia")
      .createSignedUrl(gasto.pdf_storage_path, 3600);
    pdfSignedUrl = signed?.signedUrl || null;
  }

  const metadata = {
    gasto_id: gasto.id,
    tipo: "GASTOS_ANTICIPO",
    source: "gastos_pericia",
    expediente_numero: expedienteLabel,
    caratula: gasto.caratula || null,
    juzgado: gasto.juzgado || null,
    numero: expedienteLabel,
    monto: gasto.monto,
    plazo_dias: gasto.plazo_dias,
    articulo: gasto.articulo,
    pdf_url: pdfSignedUrl,
  };

  const inserts = destinatarios.map((userId) => ({
    user_id: userId,
    title: `Anticipo de gastos — ${expedienteLabel}`,
    body: `${gasto.caratula || expedienteLabel} · ${montoStr}${
      gasto.plazo_dias ? ` · plazo ${gasto.plazo_dias} días` : ""
    }`,
    link: `/prueba-pericia?tab=gastos&gasto_id=${gasto.id}`,
    expediente_id: gasto.expediente_id || null,
    is_pjn_favorito: !gasto.expediente_id,
    metadata,
  }));

  const { error: insertError } = await svc.from("notifications").insert(inserts);
  if (insertError) {
    console.error("[gastos/notificar] Error insertando notificaciones:", insertError);
    return { ok: false, notificados: 0, reason: insertError.message };
  }

  await svc
    .from("gastos_anticipo")
    .update({
      estado: "NOTIFICADO",
      notificado_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", gastoId);

  return { ok: true, notificados: destinatarios.length };
}

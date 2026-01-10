"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { daysSince } from "@/lib/semaforo";

type Expediente = {
  id: string;
  owner_user_id: string;
  caratula: string | null;
  juzgado: string | null;
  numero_expediente: string | null;
  fecha_ultima_modificacion: string | null;
  estado: string;
};

function isoToDDMMAA(iso: string) {
  if (!iso || iso.trim() === "") return "";
  const datePart = iso.substring(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!m) return iso;
  const yy = m[1].slice(2);
  return `${m[3]}/${m[2]}/${yy}`;
}

function semaforoByAge(dias: number): "VERDE" | "AMARILLO" | "ROJO" {
  if (dias >= 60) return "ROJO";
  if (dias >= 30) return "AMARILLO";
  return "VERDE";
}

export default function VerExpedientePage() {
  const params = useParams();
  const expedienteId = params.id as string;
  
  const [loading, setLoading] = useState(true);
  const [expediente, setExpediente] = useState<Expediente | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        window.location.href = "/login";
        return;
      }

      const { data: roleData } = await supabase.rpc("is_admin_expedientes");
      if (!roleData) {
        window.location.href = "/app";
        return;
      }

      const { data: exp, error } = await supabase
        .from("expedientes")
        .select("*")
        .eq("id", expedienteId)
        .single();

      if (error || !exp) {
        setMsg(error?.message || "Expediente no encontrado");
        setLoading(false);
        return;
      }

      setExpediente(exp as Expediente);
      setLoading(false);
    })();
  }, [expedienteId]);

  if (loading) {
    return (
      <main className="container">
        <section className="card">
          <div className="page">
            <p className="helper">Cargando…</p>
          </div>
        </section>
      </main>
    );
  }

  if (!expediente) {
    return (
      <main className="container">
        <section className="card">
          <div className="page">
            {msg && <div className="error">{msg}</div>}
            <Link href="/app/expedientes" className="btn">
              Volver
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const dias = expediente.fecha_ultima_modificacion ? daysSince(expediente.fecha_ultima_modificacion) : 0;
  const semaforo = semaforoByAge(dias);
  const semaforoStyle = semaforo === "VERDE" 
    ? { background: "rgba(46, 204, 113, 0.16)", border: "1px solid rgba(46, 204, 113, 0.35)", color: "rgba(210, 255, 226, 0.95)" }
    : semaforo === "AMARILLO"
    ? { background: "rgba(241, 196, 15, 0.14)", border: "1px solid rgba(241, 196, 15, 0.35)", color: "rgba(255, 246, 205, 0.95)" }
    : { background: "rgba(231, 76, 60, 0.14)", border: "1px solid rgba(231, 76, 60, 0.35)", color: "rgba(255, 220, 216, 0.95)" };

  return (
    <main className="container">
      <section className="card">
        <div className="page">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Detalle del Expediente</h1>
            <Link href="/app/expedientes" className="btn">
              Volver
            </Link>
          </div>

          <div className="form" style={{ maxWidth: 600 }}>
            <div className="field">
              <label className="label">Semáforo</label>
              <div>
                <span
                  style={{
                    ...semaforoStyle,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "6px 12px",
                    borderRadius: 999,
                    fontWeight: 700,
                    fontSize: 12,
                    letterSpacing: 0.4,
                    minWidth: 88,
                  }}
                >
                  {semaforo}
                </span>
                <span style={{ marginLeft: 12, color: "var(--muted)", fontSize: 13 }}>
                  {dias} días desde la última modificación
                </span>
              </div>
            </div>

            <div className="field">
              <label className="label">Carátula</label>
              <div style={{ padding: "10px 12px", background: "rgba(255,255,255,.06)", borderRadius: 12, border: "1px solid rgba(255,255,255,.16)" }}>
                {expediente.caratula || <span className="muted">Sin carátula</span>}
              </div>
            </div>

            <div className="field">
              <label className="label">Juzgado</label>
              <div style={{ padding: "10px 12px", background: "rgba(255,255,255,.06)", borderRadius: 12, border: "1px solid rgba(255,255,255,.16)" }}>
                {expediente.juzgado || <span className="muted">—</span>}
              </div>
            </div>

            <div className="field">
              <label className="label">Número de Expediente</label>
              <div style={{ padding: "10px 12px", background: "rgba(255,255,255,.06)", borderRadius: 12, border: "1px solid rgba(255,255,255,.16)" }}>
                {expediente.numero_expediente || <span className="muted">—</span>}
              </div>
            </div>

            <div className="field">
              <label className="label">Fecha Última Modificación</label>
              <div style={{ padding: "10px 12px", background: "rgba(255,255,255,.06)", borderRadius: 12, border: "1px solid rgba(255,255,255,.16)" }}>
                {expediente.fecha_ultima_modificacion ? isoToDDMMAA(expediente.fecha_ultima_modificacion) : <span className="muted">—</span>}
              </div>
            </div>

            <div className="field">
              <label className="label">Estado</label>
              <div style={{ padding: "10px 12px", background: "rgba(255,255,255,.06)", borderRadius: 12, border: "1px solid rgba(255,255,255,.16)" }}>
                {expediente.estado || <span className="muted">—</span>}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

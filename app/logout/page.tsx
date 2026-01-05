"use client";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

export default function LogoutPage() {
  useEffect(() => {
    supabase.auth.signOut().then(() => (window.location.href = "/login"));
  }, []);
  return <main className="container"><section className="card"><div className="form">Saliendo…</div></section></main>;
}

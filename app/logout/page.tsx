"use client";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

export default function Logout() {
  useEffect(() => {
    (async () => {
      await supabase.auth.signOut();
      window.location.href = "/login";
    })();
  }, []);
  return null;
}

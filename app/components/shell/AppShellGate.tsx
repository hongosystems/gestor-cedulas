"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { isShellRoute } from "@/lib/shell-nav";
import AppShell from "./AppShell";

type AppShellGateProps = {
  children: React.ReactNode;
};

function readLikelyHasSession(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("sb-auth-token");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { access_token?: string } | null;
    return Boolean(parsed?.access_token);
  } catch {
    return null;
  }
}

export default function AppShellGate({ children }: AppShellGateProps) {
  const pathname = usePathname();
  const [hasSession, setHasSession] = useState<boolean | null>(readLikelyHasSession);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled) setHasSession(!!data.session);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") return;
      if (session) {
        setHasSession(true);
        return;
      }
      if (event === "SIGNED_OUT") {
        setHasSession(false);
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Mantener el shell montado mientras la sesión no esté confirmada como ausente
  // (evita remontar toda la página al resolver getSession tras reload o cambio de pestaña).
  const useShell = isShellRoute(pathname) && hasSession !== false;

  if (!useShell) {
    return <>{children}</>;
  }

  return <AppShell>{children}</AppShell>;
}

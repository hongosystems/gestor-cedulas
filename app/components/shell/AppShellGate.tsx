"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { isShellRoute } from "@/lib/shell-nav";
import AppShell from "./AppShell";

type AppShellGateProps = {
  children: React.ReactNode;
};

export default function AppShellGate({ children }: AppShellGateProps) {
  const pathname = usePathname();
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled) setHasSession(!!data.session);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) setHasSession(!!session);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const useShell = isShellRoute(pathname) && hasSession === true;

  if (!useShell) {
    return <>{children}</>;
  }

  return <AppShell>{children}</AppShell>;
}

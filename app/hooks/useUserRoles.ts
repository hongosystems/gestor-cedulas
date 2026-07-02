"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { UserRoleFlags } from "@/lib/shell-nav";

const EMPTY_ROLES: UserRoleFlags = {
  isSuperadmin: false,
  isAbogado: false,
  isAdminExpedientes: false,
  isAdminCedulas: false,
  isAdminMediaciones: false,
  isMediador: false,
  isAdminOrdenesMedicas: false,
};

async function fetchUserRoles(uid: string) {
  const [{ data: roleData }, { data: prof }] = await Promise.all([
    supabase
      .from("user_roles")
      .select(
        "is_superadmin, is_abogado, is_admin_expedientes, is_admin_cedulas, is_admin_mediaciones, is_mediador, is_admin_ordenes_medicas"
      )
      .eq("user_id", uid)
      .maybeSingle(),
    supabase.from("profiles").select("full_name").eq("id", uid).maybeSingle(),
  ]);

  return {
    roles: {
      isSuperadmin: roleData?.is_superadmin === true,
      isAbogado: roleData?.is_abogado === true,
      isAdminExpedientes: roleData?.is_admin_expedientes === true,
      isAdminCedulas: roleData?.is_admin_cedulas === true,
      isAdminMediaciones: roleData?.is_admin_mediaciones === true,
      isMediador: roleData?.is_mediador === true,
      isAdminOrdenesMedicas: roleData?.is_admin_ordenes_medicas === true,
    } satisfies UserRoleFlags,
    userName: prof?.full_name?.trim() || null,
  };
}

export function useUserRoles() {
  const [roles, setRoles] = useState<UserRoleFlags>(EMPTY_ROLES);
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [hasSession, setHasSession] = useState(false);
  const loadedOnceRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const applyRoles = (nextRoles: UserRoleFlags, nextName: string | null) => {
      setRoles(nextRoles);
      setUserName(nextName);
      loadedOnceRef.current = true;
      setLoading(false);
    };

    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (cancelled) return;

      if (!sess.session) {
        setHasSession(false);
        setRoles(EMPTY_ROLES);
        setUserEmail(null);
        setUserName(null);
        setLoading(false);
        return;
      }

      setHasSession(true);
      const uid = sess.session.user.id;
      setUserEmail(sess.session.user.email ?? null);

      const { roles: nextRoles, userName: nextName } = await fetchUserRoles(uid);
      if (cancelled) return;
      applyRoles(nextRoles, nextName);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") return;

      if (!session) {
        if (event === "SIGNED_OUT") {
          loadedOnceRef.current = false;
          setHasSession(false);
          setRoles(EMPTY_ROLES);
          setUserEmail(null);
          setUserName(null);
          setLoading(false);
        }
        return;
      }

      setHasSession(true);
      const uid = session.user.id;
      setUserEmail(session.user.email ?? null);

      if (event === "USER_UPDATED") {
        void (async () => {
          const { data: prof } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("id", uid)
            .maybeSingle();
          if (!cancelled) setUserName(prof?.full_name?.trim() || null);
        })();
        return;
      }

      if (event !== "SIGNED_IN") return;

      // Login real (p. ej. otra pestaña): recargar roles sin bloquear la UI.
      const showLoader = !loadedOnceRef.current;
      if (showLoader) setLoading(true);

      void (async () => {
        try {
          const { roles: nextRoles, userName: nextName } = await fetchUserRoles(uid);
          if (cancelled) return;
          applyRoles(nextRoles, nextName);
        } catch {
          if (!cancelled && showLoader) setLoading(false);
        }
      })();
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { roles, loading, hasSession, userEmail, userName };
}

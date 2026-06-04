"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import LayoutCard from "@/app/components/shell/LayoutCard";
import { usePageSearchBridge } from "@/app/hooks/usePageSearchBridge";
import { useUserRoles } from "@/app/hooks/useUserRoles";
import { supabase } from "@/lib/supabase";
import {
  type BandejaTab,
  canWorkflowCedulas,
  parseBandejaTab,
} from "@/lib/bandeja-utils";
import NotificationsInbox from "@/app/components/bandeja/NotificationsInbox";
import SendTransferForm from "@/app/components/bandeja/SendTransferForm";
import TransfersInbox from "@/app/components/bandeja/TransfersInbox";
import "@/app/components/bandeja/bandeja.css";

type BandejaViewProps = {
  initialTab?: BandejaTab;
};

type NavItem = {
  id: BandejaTab;
  label: string;
  icon: string;
  badge?: number;
  alert?: boolean;
  requiresWorkflow?: boolean;
};

function tabToNotificationFilter(tab: BandejaTab): "all" | "unread" | "read" {
  if (tab === "no-leidas" || tab === "accion") return "unread";
  return "all";
}

export default function BandejaView({ initialTab }: BandejaViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { roles, loading: rolesLoading, hasSession } = useUserRoles();
  const [search, setSearch] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [receivedCount, setReceivedCount] = useState(0);

  const workflow = canWorkflowCedulas(roles);

  const activeTab = useMemo(() => {
    const action = searchParams.get("action");
    if (action === "nuevo") return "nuevo" as BandejaTab;
    const tabParam = searchParams.get("tab");
    if (tabParam) return parseBandejaTab(tabParam);
    if (initialTab) return initialTab;
    return workflow ? ("recibidos" as BandejaTab) : ("no-leidas" as BandejaTab);
  }, [searchParams, initialTab, workflow]);

  usePageSearchBridge(search, setSearch);

  useEffect(() => {
    if (!hasSession && !rolesLoading) {
      window.location.href = "/login";
    }
  }, [hasSession, rolesLoading]);

  useEffect(() => {
    if (!hasSession) return;
    let mounted = true;

    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) return;

      const [{ count: unread }, receivedRes] = await Promise.all([
        supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", uid)
          .eq("is_read", false),
        workflow
          ? supabase
              .from("file_transfers")
              .select("id", { count: "exact", head: true })
              .eq("recipient_user_id", uid)
          : Promise.resolve({ count: 0, error: null }),
      ]);

      if (!mounted) return;
      setUnreadCount(unread ?? 0);
      setReceivedCount(receivedRes.count ?? 0);
    })();

    return () => {
      mounted = false;
    };
  }, [hasSession, workflow]);

  const setTab = useCallback(
    (tab: BandejaTab) => {
      if (tab === "nuevo") {
        router.push("/app/bandeja?action=nuevo");
        return;
      }
      router.push(`/app/bandeja?tab=${tab}`);
    },
    [router]
  );

  const navItems: NavItem[] = useMemo(() => {
    const items: NavItem[] = [];
    if (workflow) {
      items.push(
        { id: "recibidos", label: "Recibidos", icon: "📥", badge: receivedCount },
        { id: "enviados", label: "Enviados", icon: "📤", requiresWorkflow: true }
      );
    }
    items.push(
      { id: "no-leidas", label: "No leídas", icon: "🔴", badge: unreadCount, alert: unreadCount > 0 },
      { id: "todas", label: "Todas", icon: "📁" },
      { id: "accion", label: "Requieren acción", icon: "⚠", badge: unreadCount, alert: unreadCount > 0 }
    );
    return items;
  }, [workflow, unreadCount, receivedCount]);

  const visibleNavItems = navItems.filter((item) => !item.requiresWorkflow || workflow);

  const renderPanel = () => {
    if (activeTab === "nuevo") {
      if (!workflow) {
        return (
          <div className="bandeja-empty">
            No tenés permisos para enviar documentos con tu perfil actual.
          </div>
        );
      }
      return (
        <SendTransferForm
          embedded
          onCancel={() => setTab(workflow ? "recibidos" : "no-leidas")}
          onSuccess={() => setTab("enviados")}
        />
      );
    }

    if (activeTab === "recibidos" || activeTab === "enviados") {
      if (!workflow) {
        return <div className="bandeja-empty">Esta sección no está disponible para tu perfil.</div>;
      }
      return (
        <TransfersInbox
          mode={activeTab === "recibidos" ? "recibidos" : "enviados"}
          searchQuery={search}
        />
      );
    }

    return (
      <NotificationsInbox
        embedded
        hideFilterBar
        initialFilter={tabToNotificationFilter(activeTab)}
        searchQuery={search}
      />
    );
  };

  if (rolesLoading) {
    return (
      <LayoutCard>
        <p className="helper">Cargando bandeja…</p>
      </LayoutCard>
    );
  }

  return (
    <LayoutCard className="bandeja-layout-card">
      <div className="bandeja-shell">
        <div className="bandeja-root">
          <header className="bandeja-header">
            <div className="bandeja-header-text">
              <h1>Bandeja</h1>
              <p className="bandeja-header-subtitle">
                Mensajes, documentos, cédulas y oficios
              </p>
            </div>
          </header>

          <div className="bandeja-body">
            <nav className="bandeja-sidebar" aria-label="Filtros de bandeja">
              {workflow && (
                <button
                  type="button"
                  className="bandeja-compose-cta"
                  onClick={() => setTab("nuevo")}
                >
                  ✏️ Redactar
                </button>
              )}

              <div className="bandeja-nav-scroll">
                {visibleNavItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`bandeja-nav-item${activeTab === item.id ? " is-active" : ""}`}
                    onClick={() => setTab(item.id)}
                  >
                    <span className="bandeja-nav-label">
                      <span className="bandeja-nav-icon" aria-hidden>
                        {item.icon}
                      </span>
                      {item.label}
                    </span>
                    {item.badge != null && item.badge > 0 ? (
                      <span className={`bandeja-nav-badge${item.alert ? " is-alert" : ""}`}>
                        {item.badge}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </nav>

            <div className="bandeja-content">{renderPanel()}</div>
          </div>
        </div>
      </div>
    </LayoutCard>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePageSearchBridge } from "@/app/hooks/usePageSearchBridge";
import { usePageSearchOptional } from "@/app/components/shell/PageSearchContext";
import { useUserRoles } from "@/app/hooks/useUserRoles";
import {
  type BandejaTab,
  canWorkflowCedulas,
  parseBandejaTab,
} from "@/lib/bandeja-utils";
import { bandejaTabToFolder, isMailboxTab } from "@/lib/bandeja-mail-folders";
import { fetchMailboxFolderCounts } from "@/lib/bandeja-inbox-search";
import { fetchUnreadBadgeCounts, syncLegacyMailboxTransfers } from "@/lib/unread-notifications-client";
import NotificationsInbox from "@/app/components/bandeja/NotificationsInbox";
import MailboxComposeForm from "@/app/components/bandeja/MailboxComposeForm";
import MailboxInbox from "@/app/components/bandeja/MailboxInbox";
import "@/app/components/bandeja/bandeja.css";
import "@/app/components/bandeja/bandeja-layout.css";

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
  // Alertas: mostrar todo el historial (menciones leídas siguen visibles para responder).
  if (tab === "no-leidas") return "unread";
  return "all";
}

export default function BandejaView({ initialTab }: BandejaViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { roles, loading: rolesLoading, hasSession } = useUserRoles();
  const [search, setSearch] = useState("");
  const [folderCounts, setFolderCounts] = useState({
    sent: 0,
    all: 0,
    unread: 0,
    archived: 0,
  });
  const [notificationUnread, setNotificationUnread] = useState(0);
  const [appAlertUnread, setAppAlertUnread] = useState(0);

  const workflow = canWorkflowCedulas(roles);

  const activeTab = useMemo(() => {
    const action = searchParams.get("action");
    if (action === "nuevo") return "nuevo" as BandejaTab;
    const tabParam = searchParams.get("tab");
    let tab = tabParam ? parseBandejaTab(tabParam) : initialTab ?? (workflow ? "recibidos" : "no-leidas");
    if (tab === "archivados") tab = "recibidos";
    return tab as BandejaTab;
  }, [searchParams, initialTab, workflow]);

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam === "archivados" && workflow) {
      router.replace("/app/bandeja?tab=recibidos");
    }
    if (tabParam === "accion") {
      router.replace("/app/bandeja?tab=no-leidas");
    }
  }, [searchParams, workflow, router]);

  const pageSearch = usePageSearchOptional();
  usePageSearchBridge(search, setSearch);
  const effectiveSearch = pageSearch?.value ?? search;

  const mailboxFolder = workflow ? bandejaTabToFolder(activeTab) : null;
  const isMailView = Boolean(workflow && mailboxFolder);
  const isComposeView = activeTab === "nuevo";

  const refreshBadgeCounts = useCallback(async () => {
    if (!hasSession) return;
    try {
      const badge = await fetchUnreadBadgeCounts();
      setNotificationUnread(badge.workflow ? badge.app : badge.total);
      setAppAlertUnread(badge.app);
    } catch {
      /* mantener contadores previos */
    }
  }, [hasSession]);

  const refreshCounts = useCallback(async () => {
    if (!hasSession) return;
    await refreshBadgeCounts();
    if (!workflow) return;
    try {
      const counts = await fetchMailboxFolderCounts();
      setFolderCounts(counts);
    } catch {
      /* mantener contadores previos */
    }
  }, [workflow, hasSession, refreshBadgeCounts]);

  useEffect(() => {
    if (!hasSession && !rolesLoading) {
      window.location.href = "/login";
    }
  }, [hasSession, rolesLoading]);

  useEffect(() => {
    if (!hasSession) return;
    refreshCounts();
  }, [hasSession, refreshCounts, activeTab]);

  useEffect(() => {
    if (!hasSession || !workflow) return;
    let cancelled = false;
    (async () => {
      try {
        const imported = await syncLegacyMailboxTransfers();
        if (!cancelled && imported > 0) {
          await refreshCounts();
        }
      } catch {
        /* sync opcional al abrir bandeja */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasSession, workflow, refreshCounts]);

  const setTab = useCallback(
    (tab: BandejaTab) => {
      if (tab === "no-leidas" || tab === "alertas") {
        pageSearch?.onChange("");
        setSearch("");
      }
      if (tab === "nuevo") {
        router.push("/app/bandeja?action=nuevo");
        return;
      }
      router.push(`/app/bandeja?tab=${tab}`);
    },
    [router, pageSearch]
  );

  const navItems: NavItem[] = useMemo(() => {
    const items: NavItem[] = [];
    if (workflow) {
      items.push(
        {
          id: "recibidos",
          label: "Recibidos",
          icon: "📥",
          badge: folderCounts.unread > 0 ? folderCounts.unread : undefined,
          alert: folderCounts.unread > 0,
        },
        {
          id: "enviados",
          label: "Enviados",
          icon: "📤",
          requiresWorkflow: true,
        },
        {
          id: "no-leidas",
          label: "No leídas",
          icon: "🔴",
          badge: folderCounts.unread > 0 ? folderCounts.unread : undefined,
          alert: folderCounts.unread > 0,
        }
      );
      items.push({
        id: "alertas",
        label: "Alertas",
        icon: "🔔",
        badge: appAlertUnread > 0 ? appAlertUnread : undefined,
        alert: appAlertUnread > 0,
      });
      items.push({
        id: "todas",
        label: "Todas",
        icon: "📁",
        badge: folderCounts.all > 0 ? folderCounts.all : undefined,
      });
    } else {
      items.push(
        {
          id: "no-leidas",
          label: "No leídas",
          icon: "🔴",
          badge: notificationUnread > 0 ? notificationUnread : undefined,
          alert: notificationUnread > 0,
        },
        {
          id: "todas",
          label: "Todas",
          icon: "📁",
        }
      );
    }
    return items;
  }, [workflow, folderCounts, notificationUnread, appAlertUnread]);

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
        <section className="bandeja-compose-view" aria-label="Redactar mensaje">
          <MailboxComposeForm
            embedded
            onCancel={() => setTab(workflow ? "recibidos" : "no-leidas")}
            onSuccess={() => {
              refreshCounts();
              setTab("enviados");
            }}
          />
        </section>
      );
    }

    if (isMailView && mailboxFolder) {
      return (
        <MailboxInbox
          folder={mailboxFolder}
          searchQuery={effectiveSearch}
          onListChanged={refreshCounts}
        />
      );
    }

    if (workflow && isMailboxTab(activeTab)) {
      return (
        <div className="bandeja-empty">No se pudo cargar esta carpeta de bandeja.</div>
      );
    }

    if (activeTab === "alertas" || !workflow) {
      const threadParam = searchParams.get("thread");
      return (
        <NotificationsInbox
          embedded
          hideFilterBar
          initialFilter={tabToNotificationFilter(activeTab)}
          initialThreadId={threadParam}
          searchQuery={effectiveSearch}
          excludeMailboxLinked={workflow}
          onCountsChanged={refreshBadgeCounts}
        />
      );
    }

    return (
      <div className="bandeja-empty">No hay contenido para esta carpeta.</div>
    );
  };

  const isNotificationsView = !isMailView && !isComposeView;

  if (rolesLoading) {
    return (
      <div className="bandeja-app">
        <p className="bandeja-loading">Cargando bandeja…</p>
      </div>
    );
  }

  return (
    <div className="bandeja-app">
      <div
        className={`bandeja-workspace${isMailView ? " is-mail" : ""}${isComposeView ? " is-compose" : ""}${isNotificationsView ? " is-notifications" : ""}`}
      >
        <aside className="bandeja-sidebar" aria-label="Carpetas de bandeja">
          {workflow && (
            <button
              type="button"
              className={`bandeja-compose-cta${activeTab === "nuevo" ? " is-active" : ""}`}
              onClick={() => setTab("nuevo")}
            >
              <span className="bandeja-compose-cta-icon" aria-hidden>
                ✏️
              </span>
              Redactar
            </button>
          )}

          <nav className="bandeja-sidebar-nav">
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
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>
        </aside>

        {isComposeView || isMailView || isNotificationsView ? (
          renderPanel()
        ) : (
          <section className="bandeja-panel">{renderPanel()}</section>
        )}
      </div>
    </div>
  );
}

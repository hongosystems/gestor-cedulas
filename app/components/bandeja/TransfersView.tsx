"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePageSearchBridge } from "@/app/hooks/usePageSearchBridge";
import { usePageSearchOptional } from "@/app/components/shell/PageSearchContext";
import { useUserRoles } from "@/app/hooks/useUserRoles";
import { canWorkflowCedulas } from "@/lib/bandeja-utils";
import SendTransferForm from "@/app/components/bandeja/SendTransferForm";
import TransfersInbox from "@/app/components/bandeja/TransfersInbox";
import "@/app/components/bandeja/bandeja.css";
import "@/app/components/bandeja/bandeja-layout.css";

export type TransfersTab = "enviar" | "recibidos" | "enviados";

type TransfersViewProps = {
  initialTab?: TransfersTab;
};

function parseTransfersTab(raw: string | null): TransfersTab {
  if (raw === "enviar" || raw === "recibidos" || raw === "enviados") return raw;
  return "recibidos";
}

export default function TransfersView({ initialTab = "recibidos" }: TransfersViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { roles, loading: rolesLoading } = useUserRoles();
  const [search, setSearch] = useState("");
  const workflow = canWorkflowCedulas(roles);

  const activeTab = useMemo(() => {
    const tabParam = searchParams.get("tab");
    const tab = tabParam ? parseTransfersTab(tabParam) : initialTab;
    if (!workflow && (tab === "enviar" || tab === "enviados")) return "recibidos";
    return tab;
  }, [searchParams, initialTab, workflow]);

  const pageSearch = usePageSearchOptional();
  usePageSearchBridge(search, setSearch);
  const effectiveSearch = pageSearch?.value ?? search;

  const setTab = useCallback(
    (tab: TransfersTab) => {
      router.push(`/app/documentos?tab=${tab}`);
    },
    [router]
  );

  const navItems = useMemo(() => {
    const items: { id: TransfersTab; label: string; icon: string }[] = [];
    if (workflow) {
      items.push({ id: "enviar", label: "Enviar", icon: "✏️" });
    }
    items.push({ id: "recibidos", label: "Recibidos", icon: "📥" });
    if (workflow) {
      items.push({ id: "enviados", label: "Enviados", icon: "📤" });
    }
    return items;
  }, [workflow]);

  if (rolesLoading) {
    return (
      <div className="bandeja-app">
        <p className="bandeja-loading">Cargando…</p>
      </div>
    );
  }

  return (
    <div className="bandeja-app">
      <div className={`bandeja-workspace${activeTab === "enviar" ? " is-compose" : " is-mail"}`}>
        <aside className="bandeja-sidebar" aria-label="Envío de documentos">
          <nav className="bandeja-sidebar-nav">
            {navItems.map((item) => (
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
              </button>
            ))}
          </nav>
        </aside>

        {activeTab === "enviar" ? (
          workflow ? (
            <section className="bandeja-compose-view" aria-label="Enviar documento">
              <SendTransferForm
                embedded
                onSuccess={() => setTab("enviados")}
                onCancel={() => setTab("recibidos")}
              />
            </section>
          ) : (
            <div className="bandeja-empty">
              No tenés permisos para enviar documentos con tu perfil actual.
            </div>
          )
        ) : (
          <section className="bandeja-panel">
            <TransfersInbox
              mode={activeTab === "enviados" ? "enviados" : "recibidos"}
              searchQuery={effectiveSearch}
            />
          </section>
        )}
      </div>
    </div>
  );
}

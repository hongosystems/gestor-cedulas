export type UserRoleFlags = {
  isSuperadmin: boolean;
  isAbogado: boolean;
  isAdminExpedientes: boolean;
  isAdminCedulas: boolean;
  isAdminMediaciones: boolean;
  isMediador: boolean;
  isAdminOrdenesMedicas: boolean;
};

/** Fila de user_roles (campos usados en login y shell). */
export type UserRoleRow = {
  is_superadmin?: boolean | null;
  is_admin_expedientes?: boolean | null;
  is_admin_cedulas?: boolean | null;
  is_abogado?: boolean | null;
  is_admin_mediaciones?: boolean | null;
  is_mediador?: boolean | null;
  is_admin_ordenes_medicas?: boolean | null;
};

export function roleRowToFlags(row: UserRoleRow): UserRoleFlags {
  return {
    isSuperadmin: row.is_superadmin === true,
    isAbogado: row.is_abogado === true,
    isAdminExpedientes: row.is_admin_expedientes === true,
    isAdminCedulas: row.is_admin_cedulas === true,
    isAdminMediaciones: row.is_admin_mediaciones === true,
    isMediador: row.is_mediador === true,
    isAdminOrdenesMedicas: row.is_admin_ordenes_medicas === true,
  };
}

/**
 * Ruta de inicio tras login o ítem "Dashboard/Inicio" del sidebar.
 * Con varios roles, prioriza un home razonable (sin /select-role).
 */
export function getHomeHref(roles: UserRoleFlags): string {
  if (roles.isSuperadmin || roles.isAbogado) return "/superadmin";
  if (
    roles.isAdminExpedientes &&
    !roles.isAdminCedulas &&
    !roles.isAdminMediaciones &&
    !roles.isMediador
  ) {
    return "/app/expedientes";
  }
  if (
    (roles.isAdminMediaciones || roles.isMediador) &&
    !roles.isAdminCedulas &&
    !roles.isAdminExpedientes
  ) {
    return "/app/mediaciones";
  }
  if (roles.isAdminCedulas) return "/app";
  if (roles.isAdminExpedientes) return "/app/expedientes";
  if (roles.isAdminMediaciones || roles.isMediador) return "/app/mediaciones";
  return "/app";
}

export type ShellNavItem = {
  id: string;
  label: string;
  href: string;
  group: "menu" | "modulos" | "operaciones" | "admin";
  match?: (pathname: string) => boolean;
  visible: (roles: UserRoleFlags) => boolean;
};

function buildInicioMatch(homeHref: string): (pathname: string) => boolean {
  if (homeHref === "/superadmin") {
    return (p) => p === "/superadmin";
  }
  if (homeHref === "/app") {
    return (p) => p === "/app";
  }
  if (homeHref === "/app/mediaciones") {
    return (p) => p === "/app/mediaciones" || p.startsWith("/app/mediaciones/");
  }
  if (homeHref === "/app/expedientes") {
    return (p) => p === "/app/expedientes" || p.startsWith("/app/expedientes/");
  }
  return (p) => p === homeHref;
}

/** Ítems del menú lateral — misma visibilidad que los menús hamburguesa existentes. */
export function getShellNavItems(roles: UserRoleFlags): ShellNavItem[] {
  const canSuperDashboard = roles.isSuperadmin || roles.isAbogado;
  const canMisJuzgados = roles.isSuperadmin || roles.isAbogado || roles.isAdminExpedientes;
  const canDiligenciamiento =
    roles.isSuperadmin || roles.isAbogado || roles.isAdminCedulas;
  const canCedulas =
    roles.isSuperadmin ||
    roles.isAbogado ||
    roles.isAdminCedulas ||
    roles.isAdminExpedientes;
  const canExpedientes =
    roles.isSuperadmin || roles.isAbogado || roles.isAdminExpedientes;
  const canMediaciones =
    roles.isSuperadmin || roles.isAdminMediaciones || roles.isMediador;
  const canMediacionesLotes = roles.isSuperadmin || roles.isAdminMediaciones;
  const canPericias =
    roles.isAbogado || roles.isSuperadmin || roles.isAdminOrdenesMedicas;
  const canWorkflowCedulas =
    roles.isSuperadmin ||
    roles.isAbogado ||
    roles.isAdminExpedientes ||
    roles.isAdminCedulas;
  const canCargaExpedientes =
    roles.isSuperadmin || roles.isAbogado || roles.isAdminExpedientes;

  const homeHref = getHomeHref(roles);

  const isCedulasListRoute = (p: string) =>
    p === "/app" ||
    (p.startsWith("/app/") &&
      !p.startsWith("/app/mediaciones") &&
      !p.startsWith("/app/expedientes") &&
      !p.startsWith("/app/enviar") &&
      !p.startsWith("/app/recibidos") &&
      !p.startsWith("/app/nueva") &&
      !p.startsWith("/app/notificaciones"));

  const items: ShellNavItem[] = [
    {
      id: "inicio",
      label: canSuperDashboard ? "Dashboard" : "Inicio",
      href: homeHref,
      group: "menu",
      match: buildInicioMatch(homeHref),
      visible: () => true,
    },
    {
      id: "mis-juzgados",
      label: "Mis Juzgados",
      href: "/superadmin/mis-juzgados",
      group: "menu",
      match: (p) =>
        p === "/superadmin/mis-juzgados" || p.startsWith("/superadmin/mis-juzgados/"),
      visible: () => canMisJuzgados,
    },
    {
      id: "diligenciamiento",
      label: "Diligenciamiento",
      href: "/diligenciamiento",
      group: "modulos",
      match: (p) => p === "/diligenciamiento" || p.startsWith("/diligenciamiento/"),
      visible: () => canDiligenciamiento,
    },
    {
      id: "cedulas",
      label: "Cédulas / Oficios",
      href: "/app",
      group: "modulos",
      match: isCedulasListRoute,
      visible: () => canCedulas,
    },
    {
      id: "nueva-cedula",
      label: "Nueva Cédula/Oficio",
      href: "/app/nueva",
      group: "operaciones",
      match: (p) => p === "/app/nueva",
      visible: () => canWorkflowCedulas,
    },
    {
      id: "enviar",
      label: "Enviar Cédula/Oficio",
      href: "/app/enviar",
      group: "operaciones",
      match: (p) => p === "/app/enviar" || p.startsWith("/app/enviar/"),
      visible: () => canWorkflowCedulas,
    },
    {
      id: "recibidos",
      label: "Recibidos / Enviados",
      href: "/app/recibidos",
      group: "operaciones",
      match: (p) => p === "/app/recibidos" || p.startsWith("/app/recibidos/"),
      visible: () => canWorkflowCedulas,
    },
    {
      id: "notificaciones",
      label: "Notificaciones",
      href: "/app/notificaciones",
      group: "operaciones",
      match: (p) => p === "/app/notificaciones" || p.startsWith("/app/notificaciones/"),
      visible: () => true,
    },
    {
      id: "carga-expedientes",
      label: "Carga Expedientes",
      href: "/app/expedientes/nueva",
      group: "operaciones",
      match: (p) => p === "/app/expedientes/nueva",
      visible: () => canCargaExpedientes,
    },
    {
      id: "expedientes",
      label: "Expedientes",
      href: "/app/expedientes",
      group: "modulos",
      match: (p) =>
        (p === "/app/expedientes" || p.startsWith("/app/expedientes/")) &&
        p !== "/app/expedientes/nueva",
      visible: () => canExpedientes,
    },
    {
      id: "mediaciones",
      label: "Mediaciones",
      href: "/app/mediaciones",
      group: "modulos",
      match: (p) => p === "/app/mediaciones" || p.startsWith("/app/mediaciones/"),
      visible: () => canMediaciones,
    },
    {
      id: "mediaciones-lotes",
      label: "Lotes mediaciones",
      href: "/app/mediaciones/lotes",
      group: "modulos",
      match: (p) =>
        p === "/app/mediaciones/lotes" || p.startsWith("/app/mediaciones/lotes/"),
      visible: () => canMediacionesLotes,
    },
    {
      id: "pericias",
      label: "Prueba/Pericia",
      href: "/prueba-pericia",
      group: "modulos",
      match: (p) => p === "/prueba-pericia" || p.startsWith("/prueba-pericia/"),
      visible: () => canPericias,
    },
    {
      id: "reiteratorios",
      label: "Reiteratorios",
      href: "/reiteratorios",
      group: "modulos",
      match: (p) => p === "/reiteratorios" || p.startsWith("/reiteratorios/"),
      visible: () => roles.isSuperadmin,
    },
    {
      id: "removidos",
      label: "Exp. Removidos",
      href: "/superadmin/removidos",
      group: "admin",
      match: (p) => p === "/superadmin/removidos" || p.startsWith("/superadmin/removidos/"),
      visible: () => roles.isSuperadmin,
    },
    {
      id: "auditoria",
      label: "Auditoría",
      href: "/admin/auditoria-tipo-documento",
      group: "admin",
      match: (p) =>
        p === "/admin/auditoria-tipo-documento" ||
        p.startsWith("/admin/auditoria-tipo-documento/"),
      visible: () => roles.isSuperadmin,
    },
    {
      id: "config",
      label: "Configuración",
      href: "/superadmin/config",
      group: "admin",
      match: (p) => p === "/superadmin/config" || p.startsWith("/superadmin/config/"),
      visible: () => roles.isSuperadmin,
    },
  ];

  return items.filter((item) => item.visible(roles));
}

/** Indica si el ítem coincide con la ruta (puede haber varios; usar getActiveNavItemId para uno solo). */
export function isNavItemMatch(item: ShellNavItem, pathname: string): boolean {
  if (item.match) return item.match(pathname);
  if (pathname === item.href) return true;
  if (item.href !== "/" && pathname.startsWith(`${item.href}/`)) return true;
  return false;
}

/** Puntuación: ruta más específica gana (evita doble activo). */
function navItemMatchScore(item: ShellNavItem, pathname: string): number {
  if (!isNavItemMatch(item, pathname)) return -1;
  if (pathname === item.href) return 1_000_000 + item.href.length;
  const depth = item.href.split("/").filter(Boolean).length;
  return depth * 10_000 + item.href.length;
}

/** Un único ítem activo en el sidebar. */
export function getActiveNavItemId(
  items: ShellNavItem[],
  pathname: string
): string | null {
  let best: { id: string; score: number } | null = null;
  for (const item of items) {
    const score = navItemMatchScore(item, pathname);
    if (score < 0) continue;
    if (!best || score > best.score) {
      best = { id: item.id, score };
    }
  }
  return best?.id ?? null;
}

/** @deprecated Usar isNavItemMatch + getActiveNavItemId */
export function isNavItemActive(item: ShellNavItem, pathname: string): boolean {
  return isNavItemMatch(item, pathname);
}

export function isActive(
  item: ShellNavItem,
  pathname: string,
  activeId: string | null
): boolean {
  return activeId !== null && item.id === activeId;
}

export const SHELL_ROUTE_PREFIXES = [
  "/app",
  "/superadmin",
  "/reiteratorios",
  "/diligenciamiento",
  "/prueba-pericia",
  "/admin",
] as const;

export function isShellRoute(pathname: string): boolean {
  if (pathname === "/") return false;
  return SHELL_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

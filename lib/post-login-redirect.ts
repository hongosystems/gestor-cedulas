import { getHomeHref, roleRowToFlags, type UserRoleRow } from "@/lib/shell-nav";

/** Redirección post-login según roles (nunca /select-role). */
export function redirectAfterRoleCheck(roleData: UserRoleRow | null | undefined): void {
  if (!roleData) {
    window.location.href = "/app";
    return;
  }
  window.location.href = getHomeHref(roleRowToFlags(roleData));
}

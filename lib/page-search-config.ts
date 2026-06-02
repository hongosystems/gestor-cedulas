export type PageSearchConfig = {
  placeholder: string;
};

type RouteRule = {
  test: (pathname: string) => boolean;
  config: PageSearchConfig;
};

const RULES: RouteRule[] = [
  {
    test: (p) => p.startsWith("/superadmin/mis-juzgados"),
    config: { placeholder: "Buscar expediente, carátula…" },
  },
  {
    test: (p) => p === "/superadmin" || p.startsWith("/superadmin/"),
    config: { placeholder: "Buscar expediente, carátula, juzgado…" },
  },
  {
    test: (p) => p.startsWith("/prueba-pericia"),
    config: { placeholder: "Buscar expediente, carátula…" },
  },
  {
    test: (p) => p.startsWith("/diligenciamiento"),
    config: { placeholder: "Buscar cédula, oficio o expediente…" },
  },
  {
    test: (p) => p.startsWith("/reiteratorios"),
    config: { placeholder: "Buscar oficio, expediente o carátula…" },
  },
  {
    test: (p) => p.startsWith("/app/mediaciones"),
    config: { placeholder: "Buscar mediación, requirente…" },
  },
  {
    test: (p) => p.startsWith("/admin/auditoria"),
    config: { placeholder: "Buscar documento o expediente…" },
  },
  {
    test: (p) => p.startsWith("/app"),
    config: { placeholder: "Buscar cédula, oficio, carátula…" },
  },
];

export function getPageSearchConfig(pathname: string): PageSearchConfig {
  const rule = RULES.find((r) => r.test(pathname));
  return rule?.config ?? { placeholder: "Buscar en esta página…" };
}

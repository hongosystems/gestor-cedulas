// Módulo compartido para cookies del PJN
// Se actualiza cuando el usuario se loguea

export interface PJNCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
}

// Cookies hardcodeadas (actualizadas)
export let COOKIES: PJNCookie[] = [
  { name: "_ga", value: "GA1.3.528285508.1755536633", domain: ".pjn.gov.ar", path: "/" },
  { name: "_ga_5R55LTBDXK", value: "GS2.3.s1768259935$o79$g1$t1768259937$j58$l0$h0", domain: ".pjn.gov.ar", path: "/" },
  { name: "_gat", value: "1", domain: ".pjn.gov.ar", path: "/" },
  { name: "_gid", value: "GA1.3.2094937357.1768176730", domain: ".pjn.gov.ar", path: "/" },
  { name: "ar_debug", value: "1", domain: ".www.google-analytics.com", path: "/" },
  { name: "JSESSIONID", value: "ZewtlpeVxXkn8lbR9Qzbi2UZ.scw3_1", domain: "scw.pjn.gov.ar", path: "/scw" },
  { name: "TS010fac1f", value: "0160545d6414b11b4e4ca0889453adf1aa4e959bccc6c36f500f474d845646448ffde2b6df64690ffaa0dfa77af8cfb14cadf09d82", domain: "captcha.pjn.gov.ar", path: "/" },
  { name: "TS01663053", value: "0160545d6437ab6f493045c1c6e7832341d19b7ffcf158691582dfb898026e183621f66c257d6338712e63430ec52366908772b28a696e537c2b2aff62f451debf0b2e2e4e", domain: "scw.pjn.gov.ar", path: "/" },
  { name: "TS01cef489", value: "0160545d64217443a8f6cc0c6f7056402c3d1d1c7d9dc49e547c7aadd455e21daac73f64047dbe5c3a3c5dcf4c2a869b2ce3ff8a640cea9fd627b460acfe0aa3a13122ecc3", domain: "scw.pjn.gov.ar", path: "/scw" },
  { name: "TS01f66fe2", value: "0160545d64f78ec954633aaa7dd4ba4469f3fcbae548f2307169460b9de84ddf0de8ddac81541ba9acd123dc71f1cd22a2a7c22f6d", domain: ".pjn.gov.ar", path: "/" },
  { name: "TSed2f1074027", value: "080f2c40daab20005a8e7512de7d68a559976f21ac2aa0b5a2a25baf275b9935c50eb6d0ea0aa1830855a2befe113000ea0511b8df8c010cf2366ef590b41e8c30bb93ab8d0222e78c483f1e6227722f2fdfe20238a22dbd111d4d8b5fb69279", domain: "captcha.pjn.gov.ar", path: "/" },
  { name: "USID", value: "-mPHq7Y7CHr8NUqRqhJMUg.sDxJsw9_GvLnvg8xBisZkw0JKyqH51rUInLKaswlWPk.1768241280273.15768000.RWlZHxaQHR4Z_OLj_lLwzkEQxLyFeb5ZCJBo3pYcq7I", domain: ".pjn.gov.ar", path: "/" },
];

// Función para actualizar las cookies
export function updateCookies(newCookies: any[]) {
  COOKIES = newCookies.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain || ".pjn.gov.ar",
    path: c.path || "/",
  }));
  console.log(`Cookies actualizadas: ${COOKIES.length} cookies`);
}

// Función para obtener las cookies
export function getCookies(): PJNCookie[] {
  return COOKIES;
}

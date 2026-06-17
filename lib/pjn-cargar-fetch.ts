export type PjnCargarPayloadResult = {
  ok?: boolean;
  error?: string;
  pruebaSinEnvio?: boolean;
  queued?: boolean;
  status?: string;
};

export type PjnCargarFetchResult = {
  ok: boolean;
  status: number;
  payload: PjnCargarPayloadResult;
  text: string;
};

const DEFAULT_TOTAL_MS = 240_000;
const POLL_INTERVAL_MS = 4_000;
const POST_TIMEOUT_MS = 30_000;
const POLL_REQUEST_MS = 20_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJson(text: string): PjnCargarPayloadResult | null {
  try {
    return JSON.parse(text) as PjnCargarPayloadResult;
  } catch {
    return null;
  }
}

function isCloudflareTimeout(status: number, text: string): boolean {
  const lower = text.toLowerCase();
  return (
    status === 524 ||
    (lower.includes("cloudflare") && lower.includes("timeout")) ||
    lower.includes("error code 524")
  );
}

function cloudflareHint(status: number, text: string): string | null {
  if (!isCloudflareTimeout(status, text)) return null;
  return (
    "Timeout de Cloudflare (524): el túnel cortó la conexión antes de que el VPS respondiera. " +
    "Reintentá en unos segundos; si persiste, verificá que pjn-local esté actualizado (modo async)."
  );
}

/**
 * Encola carga PJN en el VPS (respuesta 202) y hace polling hasta terminar o timeout.
 * Evita el error "Respuesta no JSON (524)" cuando Playwright tarda más que el límite del túnel.
 */
export async function postCargarPjnAndWait(options: {
  baseUrl: string;
  payload: Record<string, unknown>;
  cedulaId: string;
  internalSecret?: string;
  totalTimeoutMs?: number;
}): Promise<PjnCargarFetchResult> {
  const {
    baseUrl,
    payload,
    cedulaId,
    internalSecret,
    totalTimeoutMs = DEFAULT_TOTAL_MS,
  } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(internalSecret ? { "X-Internal-Secret": internalSecret } : {}),
  };

  let postRes: Response;
  try {
    postRes = await fetch(`${baseUrl}/cargar-pjn`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    });
  } catch (e: unknown) {
    throw e;
  }

  const postText = await postRes.text();
  const postPayload = parseJson(postText);

  if (!postPayload) {
    const hint = cloudflareHint(postRes.status, postText);
    if (hint) {
      const polled = await pollCargarPjnStatus({
        baseUrl,
        cedulaId,
        internalSecret,
        deadline: Date.now() + totalTimeoutMs,
      });
      if (polled) return polled;
      return {
        ok: false,
        status: postRes.status,
        payload: { error: hint },
        text: postText,
      };
    }
    return { ok: false, status: postRes.status, payload: {}, text: postText };
  }

  const queued =
    postRes.status === 202 ||
    postPayload.queued === true ||
    postPayload.status === "running";

  if (!queued) {
    return {
      ok: postRes.ok && postPayload.ok === true,
      status: postRes.status,
      payload: postPayload,
      text: postText,
    };
  }

  const polled = await pollCargarPjnStatus({
    baseUrl,
    cedulaId,
    internalSecret,
    deadline: Date.now() + totalTimeoutMs,
  });
  if (polled) return polled;

  return {
    ok: false,
    status: 504,
    payload: { error: "Timeout esperando que el VPS termine la carga en PJN" },
    text: "",
  };
}

async function pollCargarPjnStatus(options: {
  baseUrl: string;
  cedulaId: string;
  internalSecret?: string;
  deadline: number;
}): Promise<PjnCargarFetchResult | null> {
  const { baseUrl, cedulaId, internalSecret, deadline } = options;
  const pollHeaders: Record<string, string> = internalSecret
    ? { "X-Internal-Secret": internalSecret }
    : {};

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    let stRes: Response;
    try {
      stRes = await fetch(
        `${baseUrl}/cargar-pjn/status/${encodeURIComponent(cedulaId)}`,
        {
          headers: pollHeaders,
          signal: AbortSignal.timeout(POLL_REQUEST_MS),
        }
      );
    } catch {
      continue;
    }

    const stText = await stRes.text();
    const stPayload = parseJson(stText);

    if (!stPayload) {
      if (isCloudflareTimeout(stRes.status, stText)) continue;
      return { ok: false, status: stRes.status, payload: {}, text: stText };
    }

    if (stPayload.status === "running" || stPayload.status === "missing") {
      continue;
    }

    if (stPayload.status === "error" || stPayload.ok === false) {
      return {
        ok: false,
        status: stRes.status >= 400 ? stRes.status : 502,
        payload: stPayload,
        text: stText,
      };
    }

    if (stPayload.status === "done" || stPayload.ok === true) {
      return {
        ok: true,
        status: 200,
        payload: stPayload,
        text: stText,
      };
    }
  }

  return null;
}

export function formatPjnNonJsonError(status: number, text: string): string {
  const hint = cloudflareHint(status, text);
  if (hint) return hint;

  const routeHint =
    text.includes("Cannot POST /cargar-pjn") || text.includes("/cargar-pjn")
      ? " El host configurado no expone POST /cargar-pjn."
      : "";

  return `Respuesta no JSON del servicio PJN (${status}).${routeHint}`;
}

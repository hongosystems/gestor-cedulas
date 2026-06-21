export function validateHifApiKey(request: Request): boolean {
  const provided = request.headers.get("X-API-Key");
  const expected = process.env.HIF_INTEGRATION_API_KEY;
  return Boolean(provided && expected && provided === expected);
}

export function unauthorizedResponse() {
  return Response.json({ error: "API key inválida o ausente" }, { status: 401 });
}

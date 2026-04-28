// app/api/aseguradoras/route.js
//
// Devuelve el listado de aseguradoras (datos abiertos SSN + AFIP).
// Lee desde data/aseguradoras.json en el repo.

import aseguradorasData from '@/data/aseguradoras.json';

export const runtime = 'edge';
export const dynamic = 'force-static';

export async function GET() {
  // Solo enviamos al front lo que necesita
  const lite = aseguradorasData.aseguradoras.map((a) => ({
    matricula: a.matricula,
    denominacion: a.denominacion,
    cuit: a.cuit,
    domicilio: a.domicilio,
  }));

  return Response.json(
    {
      total: aseguradorasData.total,
      generado: aseguradorasData.generado,
      aseguradoras: lite,
    },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
      },
    }
  );
}

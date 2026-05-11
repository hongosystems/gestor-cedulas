# Diagnóstico técnico: notificaciones con expediente vacío (caso Andrea)

## Contexto del incidente

- Usuario reporta que en `Bandeja de Notificaciones` el bloque **Información del expediente** aparece vacío:
  - `Sin carátula`
  - `Sin juzgado`
  - `Sin número`
- Caso de referencia informado por negocio:
  - Número: `104244/2024`
  - Carátula correcta: `ROMERO, MAXIMILIANO CESAR Y OTROS C/ SAMPEDRO, JUAN MANUEL Y OTRO S/DAÑOS Y PERJUICIOS(ACC.TRAN. C/LES. O MUERTE)`
- Síntoma observado en local y producción.
- El hilo problemático es de tipo `Otros Escritos / Orden médica`.

---

## Qué se observó en código

### 1) Render inicial de notificaciones priorizaba mal `metadata`

En `app/app/notificaciones/page.tsx`, el render de información del expediente elegía `metadata` solo por estar no vacía, aunque no tuviera `caratula/juzgado/numero`.

Efecto: si `metadata` tenía solo campos técnicos (`sender_id`, `transfer_id`, etc.), el bloque se mostraba vacío.

### 2) Resolución de contexto basada en notificación seleccionada (insuficiente para hilos)

El fetch de contexto tomaba mucho del mensaje clickeado.  
En hilos `Re: Re: ...`, ese mensaje suele no tener el contexto completo, aunque otro mensaje del mismo `thread_id` sí.

### 3) Flujos de origen heterogéneos sin vínculo fuerte a expediente

El caso específico es de transferencias (`Otros Escritos`) / órdenes médicas, donde:

- En `app/api/transfers/send/route.ts` la notificación se inserta con:
  - `link: /app/recibidos`
  - `metadata: { transfer_id, sender_id, doc_type, title }`
  - **sin `expediente_id`**
- En `app/api/transfers/redirect/route.ts` misma lógica (también sin `expediente_id`).
- En `app/api/transfers/upload-version/route.ts` se crea notificación aún más mínima (sin metadata de expediente).

Conclusión: para este tipo de notificación no hay relación estructural garantizada con `expedientes`.

### 4) Bug detectado en órdenes médicas (`expediente_id` mal mapeado)

En `app/api/ordenes-medicas/update-estado/route.ts` estaba guardando:

- `expediente_id: orden.id` (incorrecto, ID de orden)

en vez de:

- `expediente_id: orden.expediente_id` (correcto)

Esto rompe trazabilidad para notificaciones creadas por ese flujo.

---

## Qué se intentó durante la sesión

Se hicieron múltiples mejoras incrementales en frontend y backend:

1. Fallback por campo (`metadata` + `expedienteInfo`) en render.
2. Búsqueda de contexto en cualquier mensaje del hilo.
3. Soporte de parseo para links `?orden_id=...`.
4. Búsqueda por `numero_expediente` inferido del texto.
5. Endpoint robusto nuevo: `app/api/notifications/context/route.ts` para resolver contexto en backend.
6. Integración del frontend para consultar ese endpoint como fuente principal.
7. Corrección en `update-estado` para usar `orden.expediente_id`.

---

## Resultado funcional observado

- Se logró evitar varios casos de vacío.
- Pero en el caso reportado por negocio siguió fallando o devolviendo carátula incorrecta en algunos intentos.
- Diagnóstico final: **el origen de esa notificación no trae una FK fuerte a expediente**, por lo que los fallbacks pueden acertar o fallar según texto/metadata disponible.

---

## Causa raíz (root cause)

No hay un contrato de datos único y obligatorio que garantice que toda notificación tenga contexto de expediente resoluble de forma determinística.

En particular para transferencias (`file_transfers`) y algunas respuestas:

- no se persiste `expediente_id` de forma sistemática;
- el contexto depende de metadata opcional y/o parsing de texto;
- hay legacy data ya creada sin campos suficientes;
- hubo además un bug puntual en `update-estado` que guardó IDs incorrectos.

---

## Qué cambió entre “ayer funcionaba” y “hoy no”

No necesariamente cambió el expediente.  
Cambió la **fuente/tipo de notificación** que llegó al hilo (o una respuesta del hilo), y ese tipo no traía contexto estructural suficiente.

Por eso:

- ayer podía “verse bien” (porque hubo metadata/contexto favorable),
- hoy puede quedar vacío o incorrecto (porque el nuevo mensaje/hilo no trae vínculo fuerte).

---

## Solución fuerte y robusta recomendada (definitiva)

### A) Modelo de datos

1. Agregar `expediente_id` a `file_transfers` (si no existe en el esquema real desplegado).
2. Agregar snapshot opcional en transfer:
   - `expediente_numero`
   - `expediente_caratula`
   - `expediente_juzgado`
3. Garantizar que toda notificación derivada de transferencia/reply herede ese contexto.

### B) Contrato de notificación

Definir como regla: toda fila en `notifications` debe tener al menos uno de:

- `expediente_id` válido, o
- `metadata.expediente_ref` consistente, o
- `metadata.transfer_id` resoluble a `file_transfers.expediente_id`.

### C) Resolver contexto en backend (single source of truth)

Mantener el endpoint `/api/notifications/context` como resolver central.  
El frontend no debe “inventar” carátula desde título si no hay resolución de BD.

### D) Backfill histórico

Proceso de migración para notificaciones antiguas:

1. Para cada notificación con `metadata.transfer_id`, buscar `file_transfers` y completar `expediente_id`/snapshot.
2. Si falta, intentar match por `numero_expediente` en texto.
3. Marcar registros no resolubles para revisión manual.

### E) Observabilidad

Agregar logging temporal por `notification_id/thread_id` con:

- `source` de resolución (`metadata`, `ordenes_medicas`, `cedulas`, `expedientes`, etc.),
- éxito/falla por etapa,
- datos clave usados en lookup.

---

## Estado actual del repo tras la sesión

Se añadieron cambios en:

- `app/app/notificaciones/page.tsx`
- `app/api/ordenes-medicas/update-estado/route.ts`
- `app/api/notifications/context/route.ts` (nuevo)

No se reportaron errores de lint en los archivos modificados.

---

## Resumen ejecutivo para producto/negocio

El problema no es un “if de UI” aislado: es de **trazabilidad de datos entre módulos** (notificaciones, transferencias, órdenes, expedientes).  
Mientras algunas notificaciones no tengan vínculo estructural obligatorio al expediente, aparecerán casos vacíos o erróneos de forma intermitente.

La solución definitiva es modelar y persistir esa relación de forma obligatoria en origen, y resolver contexto desde backend con reglas únicas.

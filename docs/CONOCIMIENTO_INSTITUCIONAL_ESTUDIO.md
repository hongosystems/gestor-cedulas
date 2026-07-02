# Conocimiento institucional — Estudio Hisi / Gestor Cédulas

> **Propósito:** capa de conocimiento para un asistente LLM (Claude u otro) integrado al ecosistema `gestor-cedulas`.  
> **Audiencia:** modelo que responda preguntas operativas del estudio jurídico.  
> **Regla de oro:** la base de datos dice *qué pasó*; este documento dice *quién hace qué*, *qué significa cada cosa* y *cómo interpretar estados y trabas*.  
> **Última revisión:** junio 2026 — cerrado con validación de Rodrigo.

---

## 0. Cómo usar este documento

### 0.1 Dos capas de verdad

| Capa | Qué contiene | Ejemplo |
|------|--------------|---------|
| **Dato (DB / sistema)** | Timestamps, flags, conteos, `owner_user_id`, semáforos calculados | `pjn_cargado_at = 2026-03-15`, `estado_ocr = error` |
| **Conocimiento (este doc)** | Reparto de trabajo, significado operativo, excepciones humanas | "Guido maneja LSG", "Andrea administra órdenes médicas" |

El asistente debe **combinar ambas**:

- *"¿Qué hace Micaela?"* → actividad registrada (dato) + áreas asignadas (conocimiento).
- *"¿Quién maneja LSG?"* → **Guido** (conocimiento), aunque en DB solo exista la frase en la carátula del expediente.
- *"¿Quién administra las órdenes médicas?"* → **Andrea** opera el circuito; **Francisco** es el abogado responsable del área Prueba/Pericia y órdenes médicas.

### 0.2 Convenciones

- **CONFIRMADO (estudio):** validado por quien opera el estudio (Rodrigo, junio 2026).
- **CONFIRMADO (código/docs):** respaldado por el repositorio `gestor-cedulas`.
- **INFERIDO:** deducido de trazas o docs; secundario frente a confirmación del estudio.

### 0.3 Identificadores en el sistema

| Persona | Email | Rol técnico en DB (referencia) |
|---------|-------|--------------------------------|
| Gustavo Hisi | `gfhisi@gmail.com` | SuperAdmin |
| Jorge Alejandro Ifran | `ifran_jorge@hotmail.com` | SuperAdmin |
| Andrea Villan | `andreaestudio24@gmail.com` | Admin Cédulas + `is_admin_ordenes_medicas` |
| Micaela Heinrich | `micaelaestudio01@gmail.com` | Admin Cédulas |
| Gabriel Crespo | `autorizadosestudiohif@gmail.com` | Admin Cédulas |
| Magali Flores | `mf.magaliflores@gmail.com` | Admin Cédulas |
| Francisco Querinuzzi | `novedadesgh@outlook.com` | Admin Cédulas |
| Guido Querinuzzi | `victoria.estudiohisi@gmail.com` | Admin Cédulas |
| Maggie Collado | `maggiecollado@gmail.com` | Admin Cédulas (ver nota operativa abajo) |
| Rodrigo Olivera | `oliverarodrigo86@gmail.com` | SuperAdmin / desarrollo |

Los **abogados** con juzgados asignados se gestionan en WebMaster (`is_abogado` + `user_juzgados`). Maggie opera como **abogada transversal** a todos los casos del estudio, al igual que el resto de los abogados del equipo.

---

## 1. Mapa de responsabilidades — personas → funciones

> **Importante:** esto **no está en ninguna tabla**. Es conocimiento institucional. El sistema registra `owner_user_id`, menciones, notificaciones y timestamps, pero no "área de trabajo" como columna.

### 1.1 Resumen rápido (consulta directa del LLM)

| Persona | Áreas / funciones operativas | Módulos del sistema |
|---------|------------------------------|---------------------|
| **Micaela Heinrich** | Cédulas y oficios; mediaciones | `/app`, `/app/nueva`, `/app/mediaciones`, bandeja |
| **Gabriel Crespo** | **Igual que Micaela:** cédulas/oficios + mediaciones | Mismos módulos que Micaela |
| **Guido Querinuzzi** | **Litigar sin Gastos (LSG)** | `/superadmin/mis-juzgados`, favoritos PJN con carátula LSG |
| **Andrea Villan** | **Administra** el circuito de órdenes médicas (contactos, turnos, seguimiento) | `/prueba-pericia` → Órdenes/Seguimiento |
| **Francisco Querinuzzi** | **Abogado responsable** de Prueba/Pericia y órdenes médicas (área jurídica); sube órdenes desde detección | `/prueba-pericia` → Detección |
| **Magali Flores** | Audiencias de mediaciones (asiste en sede) | Referenciada en lotes de mediaciones |
| **Maggie Collado** | **Abogada transversal** a todos los casos del estudio (como el resto de los abogados) | `/superadmin/mis-juzgados`, expedientes/cédulas/oficios por juzgado |
| **Gustavo Hisi** | Dirección; SuperAdmin; dashboard; WebMaster | Todo el sistema |
| **Jorge Ifran** | SuperAdmin; acceso total | Todo el sistema |
| **Rodrigo Olivera** | Desarrollo y operación técnica del gestor | SuperAdmin, auditoría, reiteratorios, deploy |

### 1.2 Relaciones clave entre personas

```
Cédulas / Oficios / Mediaciones
├── Micaela Heinrich
└── Gabriel Crespo          (mismo alcance que Micaela)

Litigar sin Gastos (LSG)
└── Guido Querinuzzi

Prueba / Pericia + Órdenes médicas
├── Francisco Querinuzzi    → abogado responsable del área
└── Andrea Villan           → administra el circuito operativo en el sistema

Mediaciones — audiencias
└── Magali Flores

Abogados transversales (todos los casos del estudio)
├── Maggie Collado
└── (resto de abogados con juzgados en user_juzgados)
```

### 1.3 Fichas por persona

#### Micaela Heinrich — CONFIRMADO
- **Área:** cédulas y oficios; mediaciones (alta, seguimiento, documentos, lotes).
- **Interviene en:** subida de documentos, marcar En Trámite / Completa, notas con menciones, trámites de mediación.
- **Módulos:** `/app`, `/app/nueva`, `/app/mediaciones`, `/app/mediaciones/lotes`, bandeja, notificaciones.

#### Gabriel Crespo — CONFIRMADO
- **Área:** **la misma que Micaela** — cédulas/oficios + mediaciones.
- **Interviene en:** mismos flujos y módulos que Micaela.
- **Para el LLM:** si preguntan quién hace mediaciones o cédulas además de Micaela, incluir a Gabriel.

#### Guido Querinuzzi — CONFIRMADO
- **Área:** **Litigar sin Gastos (LSG)**.
- **Qué es LSG:** subconjunto de expedientes cuya carátula contiene `BENEFICIO DE LITIGAR SIN GASTOS` o `S/BENEFICIO DE LITIGAR SIN GASTOS`. No es un flag en DB.
- **Código:** `app/api/get-users-by-juzgado/route.ts` agrega a Guido automáticamente cuando la carátula tiene beneficio LSG.
- **Operación:** causas sin gastos; en la práctica también coordinación presencial (Plata, etc.).

#### Andrea Villan — CONFIRMADO
- **Área:** **administración operativa** de órdenes médicas y seguimiento de pericias médicas.
- **Rol técnico:** `is_admin_ordenes_medicas = true`.
- **Hace:** contacto con cliente, centro médico, turnos, seguimiento pre-turno, cierre de estudio.
- **No es:** la abogada titular del área Prueba/Pericia — eso es Francisco. Andrea **administra** el circuito en el sistema.
- **Asignación automática:** al crear una orden, el workflow busca usuario "Andrea" para la gestión.

#### Francisco Querinuzzi — CONFIRMADO
- **Área:** **abogado responsable** de todo lo relacionado con **Órdenes médicas** y **Prueba/Pericia**.
- **Andrea administra** el circuito operativo (contactos, turnos, estados en el sistema).
- **Francisco:** titular jurídico del área; sube órdenes desde detección en `/prueba-pericia`; recibe notificación cuando se marca estudio realizado.
- **Distinción importante para el LLM:**
  - Pregunta "¿quién es el abogado del área?" → **Francisco**
  - Pregunta "¿quién gestiona los contactos y turnos?" → **Andrea**

#### Magali Flores — CONFIRMADO (código)
- **Área:** **asistencia a audiencias de mediaciones** en sede.
- **Evidencia:** texto default de lotes: *"Tratar con Magaly Flores que es quien asiste a las audiencias"* (`mf.magaliflores@gmail.com`).

#### Maggie Collado — CONFIRMADO
- **Área:** **abogada transversal** a todos los casos del estudio, **como el resto de los abogados**.
- **Significa:** ve y sigue expedientes, cédulas y oficios según juzgados/casos del estudio; no tiene una línea exclusiva tipo LSG u órdenes médicas.
- **Módulos típicos:** `/superadmin/mis-juzgados`, apertura de documentos, seguimiento por juzgado.

#### Gustavo Hisi — CONFIRMADO
- SuperAdmin, dirección del estudio y del sistema. Dashboard, WebMaster, configuración. Puede operar cualquier módulo; delega al equipo.

#### Jorge Ifran — CONFIRMADO
- SuperAdmin con acceso total.

#### Rodrigo Olivera — CONFIRMADO (código)
- Desarrollo y mantenimiento del gestor. SuperAdmin. Módulos técnicos: reiteratorios, auditoría PDF, OCR histórico, deploy.

### 1.4 Preguntas frecuentes — respuestas canónicas

| Pregunta | Respuesta |
|----------|-----------|
| ¿Quién maneja LSG? | **Guido Querinuzzi** |
| ¿Qué hace Micaela? | Cédulas/oficios + mediaciones |
| ¿Qué hace Gabriel? | **Lo mismo que Micaela** |
| ¿Quién es el abogado de Prueba/Pericia y órdenes médicas? | **Francisco Querinuzzi** |
| ¿Quién administra las órdenes médicas en el sistema? | **Andrea Villan** |
| ¿Quién va a audiencias de mediación? | **Magali Flores** |
| ¿Qué hace Maggie? | Abogada transversal a todos los casos del estudio |
| ¿Quién carga en PJN? | Usuarios con acceso a Diligenciamiento (abogados + admin cédulas + superadmin) |

---

## 2. Glosario de negocio

### 2.1 Documentos: cédula vs oficio

| Término | En DB | Significado |
|---------|-------|-------------|
| **Cédula** | `cedulas.tipo_documento = 'CEDULA'` | Notificación/diligenciamiento típico |
| **Oficio** | `cedulas.tipo_documento = 'OFICIO'` | Oficio judicial; OCR `/procesar-oficio`; campo `ocr_destinatario` |
| **Otros escritos** | `'OTROS_ESCRITOS'` | UI: "Causas Penales" |
| **Cédula y oficio** | Misma tabla `cedulas` | No existe tabla `oficios` separada |

### 2.2 Presentado / cargado en PJN

| Término | Campo | Significado |
|---------|-------|-------------|
| **Cargado en PJN** | `pjn_cargado_at` | Escrito subido al portal PJN |
| **Presentado** (coloquial) | Suele = `pjn_cargado_at` | Mismo timestamp para cédulas y oficios |
| **Reiteratorio presentado** | `observaciones_pjn` con prefijo `"Reiteratorio presentado: "` | Segundo escrito; distinto del cargado inicial |

### 2.3 Litigar sin Gastos (LSG)

- No es tipo de documento ni rol en `user_roles`.
- Se identifica por texto en carátula del expediente/favorito PJN.
- **Responsable humano:** Guido Querinuzzi.
- **Detección automática:** filtros en dashboard/Mis Juzgados + `get-users-by-juzgado`.

### 2.4 En Trámite vs En Diligenciamiento vs Completa

Estados de **UI** en Mis Cédulas (`app/app/page.tsx`), evaluados en este orden:

| Estado UI | Condición | Quién lo dispara |
|-----------|-----------|------------------|
| **Completa** | `admin_cedulas_completada_at` seteado | Admin Cédulas — botón "Completa" |
| **Completa** (oficio) | `tipo_documento = OFICIO` Y `pjn_cargado_at` seteado | Automático al cargar PJN |
| **En Diligenciamiento** | `pjn_cargado_at` seteado (cédula) | Tras carga PJN |
| **En Trámite** | `admin_cedulas_en_tramite_at` seteado | Admin Cédulas — botón "En Trámite" |
| **Pendiente** | Ninguno de los anteriores | Estado inicial |

**Clave:** **"En Trámite" solo aparece cuando alguien de Admin Cédulas lo marca explícitamente.** No se deduce de OCR ni de PJN. Columna: `admin_cedulas_en_tramite_at`. El bubble "En Trámite" en Mis Juzgados usa la misma columna.

**Mis Juzgados** usa estados más simples: Completa / En Tramite / Pendiente (sin "En Diligenciamiento").

### 2.5 Semáforo

- VERDE / AMARILLO / ROJO = urgencia por antigüedad; **no** es estado operativo.
- Cédulas/oficios: umbrales 0–29 / 30–59 / 60+ días efectivos (enero no cuenta).
- Mis Cédulas congela el reloj al completar o cargar PJN; dashboard SuperAdmin no siempre congela.

### 2.6 Diligenciamiento

- Pantalla de **carga automatizada en PJN** (Playwright).
- Acceso: abogados, admin cédulas, superadmin.
- Lista: `estado_ocr IN ('listo', 'procesando')`.

---

## 3. Módulos del sistema

| Módulo | Ruta | Tablas principales | Función |
|--------|------|-------------------|---------|
| Cédulas/Oficios | `/app`, `/app/nueva` | `cedulas` | Alta y seguimiento documental |
| Diligenciamiento PJN | `/diligenciamiento` | `cedulas` | Carga al portal PJN |
| Expedientes | `/app/expedientes` | `expedientes` | Expedientes del estudio |
| Mis Juzgados | `/superadmin/mis-juzgados` | `cedulas`, `expedientes`, `pjn_favoritos` | Vista por juzgado |
| Favoritos PJN | sync cron | `pjn_favoritos`, `cases` | Réplica favoritos PJN |
| Mediaciones | `/app/mediaciones` | `mediaciones` + hijas | Mediación prejudicial |
| Lotes mediaciones | `/app/mediaciones/lotes` | `mediacion_lotes` | Envío masivo email |
| Prueba/Pericia | `/prueba-pericia` | `expedientes`, `ordenes_medicas`, … | Detección + órdenes médicas |
| Reiteratorios | `/reiteratorios` | `cedulas` (filtro) | Oficios en PJN ≥14 días |
| Bandeja | `/app/bandeja` | `mailbox_*` | Correo interno |
| Transferencias | `/app/enviar`, `/app/recibidos` | `file_transfers` | Envío archivos legacy |
| Notificaciones | `/app/notificaciones` | `notifications` | Menciones, alertas |
| Chat | integrado | `conversations`, `messages` | Mensajería |
| Dashboard | `/superadmin` | agregaciones | KPIs |
| WebMaster | `/webmaster` | `profiles`, `user_roles` | Usuarios |
| Auditoría PDF | `/admin/auditoria-tipo-documento` | `cedulas_tipo_documento_pdf_audit` | Clasificación CEDULA/OFICIO |
| Gastos pericia | en pericia | `gastos_anticipo` | Anticipos detectados |

### Servicios externos

| Servicio | Variable | Función |
|----------|----------|---------|
| Supabase | `NEXT_PUBLIC_SUPABASE_URL` | Auth, DB, Storage |
| OCR Railway | `RAILWAY_OCR_URL` | `/procesar`, `/procesar-oficio` |
| Carga PJN | `RAILWAY_CARGAR_PJN_URL` / `PJN_LOCAL_URL` | Playwright `/cargar-pjn` |
| PJN Scraper | Supabase secundario | `cases`, `case_snapshots` |
| OpenAI | `OPENAI_API_KEY` | Auditoría PDF |
| Resend | — | Email lotes mediaciones |

---

## 4. Estados por módulo

### 4.1 Tabla `cedulas`

| Campo | Valores | Significado |
|-------|---------|-------------|
| `tipo_documento` | CEDULA, OFICIO, OTROS_ESCRITOS, NULL | Clasificación |
| `estado` | ej. CERRADA | Excluido de listados abiertos |
| `estado_ocr` | null, procesando, listo, error | Pipeline OCR |
| `ocr_error` | texto | Detalle si error OCR |
| `fecha_carga` | timestamp | Entrada al gestor |
| `pjn_cargado_at` | timestamp / null | Cargado en PJN |
| `pjn_cargado_por` | uuid | Quién cargó/confirmó |
| `admin_cedulas_en_tramite_at` | timestamp / null | Marcado "En Trámite" |
| `admin_cedulas_completada_at` | timestamp / null | Marcado "Completa" |
| `observaciones_pjn` | texto | Error PJN o reiteratorio presentado |
| `read_by_user_id` | uuid | Lectura por abogado |

#### Pipeline OCR

```
upload → procesando → listo
              ↓
            error → [Reintentar OCR] → procesando → ...
```

| `estado_ocr` | UI | Acción |
|--------------|-----|--------|
| null / pendiente | Sin OCR listo | Disparar o esperar OCR |
| procesando | "Procesando…" | Esperar |
| listo | En Diligenciamiento | Puede cargarse PJN |
| error | "Reintentar OCR" | Admin Cédulas reintenta |

#### Pipeline PJN (Diligenciamiento)

```
estado_ocr=listo → Cargar PJN → ok → pjn_cargado_at
                      ↓ fallo
              observaciones_pjn = error → UI "⚠️ Reintentar"
```

| Señal UI | Campo | Significado |
|----------|-------|-------------|
| ⏳ Procesando | procesando o carga en curso | No intervenir |
| ✅ Cargado | `pjn_cargado_at` NOT NULL | Éxito |
| ⚠️ Reintentar | `observaciones_pjn` con error | Falló PJN |

### 4.2 `expedientes`

| Campo | Valores | Significado |
|-------|---------|-------------|
| `estado` | ABIERTO, CERRADO, … | Activo vs cerrado |
| `fecha_ultima_modificacion` | ISO | Base semáforo |
| `semaforo_congelado` | boolean | Renuncia pericia |

### 4.3 `pjn_favoritos`

- `removido` / `estado = REMOVIDO`: ya no en favoritos PJN.
- `movimientos`: actuaciones del expediente.
- `fecha_ultima_carga`: último movimiento (sync).

### 4.4 Mediaciones — `mediaciones.estado`

| Estado | Significado |
|--------|-------------|
| `borrador` | En preparación |
| `pendiente_rta` | Esperando respuesta |
| `devuelto` | Con observaciones |
| `reenviado` | Corregido y reenviado |
| `aceptado` | Listo para documento |
| `doc_generado` | PDF generado |
| `enviado` | Despachado en lote |

**Operadores habituales:** Micaela y Gabriel. **Audiencias:** Magali.

### 4.5 Órdenes médicas

**Abogado del área:** Francisco. **Administradora operativa:** Andrea.

#### `ordenes_medicas.estado`
`NUEVA` | `EN_PROCESO` | `COMPLETADA` | `CANCELADA` | `RENUNCIADO`

#### `gestiones_estudio.estado`

| Estado | Significado |
|--------|-------------|
| `PENDIENTE_CONTACTO_CLIENTE` | Andrea debe contactar |
| `CONTACTO_CLIENTE_FALLIDO` | Falló — permite reintentos |
| `CONTACTO_CLIENTE_OK` | Cliente contactado |
| `TURNO_CONFIRMADO` | Turno fijado |
| `SEGUIMIENTO_PRE_TURNO` | Hasta fecha de estudio |
| `ESTUDIO_REALIZADO` | Cerrado; notifica a Francisco |
| `CANCELADA` | Cancelada |

**Flujo:**
1. Francisco sube orden (Detección en `/prueba-pericia`).
2. Andrea gestiona contactos, turnos y estados.
3. Al cerrar estudio → notificación a Francisco.

### 4.6 Reiteratorios

**Universo:** `tipo_documento = OFICIO` + `estado_ocr = listo` + `pjn_cargado_at` NOT NULL + ≥14 días calendario desde `pjn_cargado_at`.

**Presentado:** `observaciones_pjn` = `"Reiteratorio presentado: {ISO}"`.

### 4.7 Mailbox

`document_status`: open | pending | in_review | answered | closed

### 4.8 Gastos anticipo

`NUEVO` → `NOTIFICADO` → `REVISADO`

---

## 5. Flujos operativos

### 5.1 Cédula/oficio → PJN

1. Micaela o Gabriel sube PDF (`/app/nueva`).
2. OCR: `procesando` → `listo`.
3. (Opcional) Marcar **En Trámite** → `admin_cedulas_en_tramite_at`.
4. Diligenciamiento: carga PJN → `pjn_cargado_at` o error en `observaciones_pjn`.
5. Cierre: oficio → Completa automática con PJN; cédula → Completa manual o En Diligenciamiento.

### 5.2 Reiteratorio

Oficio ≥14 días en PJN → `/reiteratorios` → presentar → `observaciones_pjn` con prefijo reiteratorio.

### 5.3 Orden médica

Francisco (detección) → Andrea (gestión) → notificación a Francisco (cierre).

### 5.4 Mediación

Micaela o Gabriel (trámite) → lote email → Magali (audiencia en sede).

### 5.5 LSG

Expediente con carátula beneficio → Guido como responsable humano.

---

## 6. Diagnóstico de trabas

```
¿estado_ocr = error?
  → Reintentar OCR (Mis Cédulas). Responsables: Micaela, Gabriel.

¿observaciones_pjn con texto y pjn_cargado_at NULL?
  → Falló PJN. Reintentar en Diligenciamiento.

¿estado_ocr = procesando prolongado?
  → Posible worker OCR colgado. Escalar Rodrigo/Gustavo.

¿admin_cedulas_en_tramite_at sin avance?
  → Estado humano intencional, no error técnico.

¿CONTACTO_CLIENTE_FALLIDO en orden médica?
  → Andrea reintenta contacto.

¿mediación en devuelto?
  → Micaela o Gabriel corrigen y reenvían.
```

| Síntoma | Causa | Quién |
|---------|-------|-------|
| Reintentar OCR | `estado_ocr=error` | Micaela / Gabriel |
| ⚠️ Reintentar (Diligenciamiento) | Fallo Playwright PJN | Abogado o admin con acceso |
| No en Diligenciamiento | OCR no listo | Esperar / reintentar OCR |
| Orden sin avance | Contacto fallido | Andrea |
| LSG sin Guido en lista | Carátula sin frase beneficio | Verificar carátula |

---

## 7. Roles técnicos vs responsabilidades humanas

| Rol DB | Permisos | No implica |
|--------|----------|------------|
| `is_superadmin` | Todo | Que haga el trabajo operativo diario |
| `is_admin_cedulas` | Mis Cédulas, diligenciamiento | Área exclusiva (varios lo tienen) |
| `is_admin_ordenes_medicas` | Órdenes en cualquier expediente | Andrea en la práctica |
| `is_admin_mediaciones` | Mediaciones + lotes | Micaela / Gabriel en la práctica |
| `is_abogado` | Mis Juzgados por `user_juzgados` | Dueño de todas las causas |

**El LLM no debe inferir responsabilidades solo desde `user_roles`.** Usar sección 1.

---

## 8. Ejemplos dato + conocimiento

**¿Quién mira LSG?**  
Conocimiento: Guido. Dato: carátula con beneficio; `get-users-by-juzgado` lo incluye.

**¿Qué hace Gabriel?**  
Conocimiento: igual que Micaela. Dato: `owner_user_id` en cédulas/mediaciones recientes.

**¿Quién lleva pericia?**  
Conocimiento: Francisco (abogado del área), Andrea (administra). Dato: `emitida_por_user_id`, `responsable_user_id` en gestiones.

**¿Cédula con Reintentar en diligenciamiento?**  
Dato: `observaciones_pjn` con error, `pjn_cargado_at` NULL. Acción: reintentar PJN.

---

## 9. Mapa cerrado — validación final (junio 2026)

| Persona | Responsabilidad confirmada |
|---------|---------------------------|
| Micaela Heinrich | Cédulas/oficios + mediaciones |
| Gabriel Crespo | **Igual que Micaela** |
| Guido Querinuzzi | Litigar sin Gastos (LSG) |
| Andrea Villan | **Administra** órdenes médicas y seguimiento (circuito operativo) |
| Francisco Querinuzzi | **Abogado responsable** de Prueba/Pericia y órdenes médicas |
| Magali Flores | Audiencias de mediaciones |
| Maggie Collado | **Abogada transversal** a todos los casos del estudio |
| Gustavo Hisi | SuperAdmin / dirección |
| Jorge Ifran | SuperAdmin |
| Rodrigo Olivera | Desarrollo y operación técnica del gestor |

**Sin pendientes.** Este mapa es la fuente de verdad para preguntas de "quién hace qué".

---

## 10. Referencias en el repositorio

| Tema | Archivo |
|------|---------|
| Arquitectura | `gestor-cedulas-plataforma-context.md` |
| Dependencias | `GESTOR-CEDULAS-transversal-context.md` |
| Flujos | `docs/CONTEXTO_PROYECTO_COMPLETO.md` |
| Semáforos | `docs/semaforos-sistema-completo.md` |
| Órdenes médicas | `docs/ordenes-seguimiento-mvp.md` |
| Cédula vs oficio | `docs/auditoria-tipo-documento-reiteratorios.md` |
| Estados Mis Cédulas | `app/app/page.tsx` → `getEstadoCedula` |
| LSG → Guido | `app/api/get-users-by-juzgado/route.ts` |
| Diligenciamiento | `app/diligenciamiento/page.tsx` |
| Navegación por rol | `lib/shell-nav.ts` |

---

## 11. Instrucción final para Claude

1. Preguntas de **"quién"** → sección 1 y 9 primero; luego datos de actividad.
2. Preguntas de **"estado"** → distinguir UI, `estado_ocr`, PJN y semáforo.
3. **En Trámite** = `admin_cedulas_en_tramite_at` (manual).
4. **Reintentar** en diligenciamiento ≠ **Reintentar OCR** (fallo PJN vs fallo OCR).
5. **LSG** = Guido + carátula; no hay tabla LSG.
6. **Oficio y cédula** = tabla `cedulas`.
7. **Gabriel = Micaela** en alcance operativo.
8. **Francisco** = abogado del área pericia/órdenes; **Andrea** = administración del circuito.
9. **Maggie** = abogada transversal, como el resto de los abogados del estudio.
10. La comprensión integral **no sale de SQL más complejo**; sale de **este documento + los datos**.

---

*Documento cerrado para integración con asistente LLM. Mantener actualizado cuando cambie el reparto de trabajo en el estudio.*

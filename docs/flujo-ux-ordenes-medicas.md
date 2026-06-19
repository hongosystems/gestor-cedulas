# Flujo de UX - Órdenes Médicas y Seguimiento

## 🎯 Resumen Visual

El sistema funciona en **2 tabs principales**:

1. **Tab "Detección"** - Vista actual (sin cambios)
2. **Tab "Órdenes/Seguimiento"** - Nueva funcionalidad

---

## 📋 Flujo Completo Paso a Paso

### **PASO 1: Crear Orden Médica**

**Desde:** Tab "Detección"

1. En la tabla de expedientes, cada fila tiene un botón **"Crear Orden Médica"**
2. Haces clic → se abre selector de archivo
3. Seleccionas el archivo PDF/DOC de la orden médica
4. Se sube automáticamente y se crea:
   - ✅ Registro en `ordenes_medicas` (estado: NUEVA)
   - ✅ Registro en `gestiones_estudio` (estado: PENDIENTE_CONTACTO_CLIENTE)
   - ✅ Asignación automática a "Andrea" (o usuario actual si no existe)

**Resultado:** La orden aparece en el tab "Órdenes/Seguimiento"

---

### **PASO 2: Ver y Gestionar Órdenes**

**Desde:** Tab "Órdenes/Seguimiento"

1. **Tabla de órdenes** muestra:
   - Semáforo SLA (verde/amarillo/rojo según días sin contacto)
   - Case Ref (referencia del caso)
   - Archivo (nombre del archivo)
   - Estado Gestión (ej: "PENDIENTE_CONTACTO_CLIENTE")
   - Centro Médico, Turno, Responsable (si están asignados)
   - Días sin contacto
   - Botón **"Abrir"**

2. **Haces clic en "Abrir"** → Se abre el **Drawer** (panel lateral derecho)

---

### **PASO 3: Drawer - Panel de Detalles**

El Drawer muestra:

#### **📄 Información Básica**
- Case Ref
- Archivo
- Estado (si hay gestión)
- Centro Médico (si está asignado)
- Turno (si está asignado)

#### **⬇️ Botón: Descargar Orden Médica**
- Descarga el archivo PDF/DOC original

#### **⚙️ Sección: Acciones**

**Si NO hay gestión:**
- ⚠️ Mensaje: "Esta orden no tiene gestión asociada"
- Botón: **"➕ Crear Gestión"** → Crea la gestión inicial

**Si SÍ hay gestión, aparecen botones según el estado:**

**Estado: PENDIENTE_CONTACTO_CLIENTE**
- 📞 **Registrar Contacto Cliente**
- 🏥 **Registrar Contacto Centro Médico**

**Estado: CONTACTO_CLIENTE_OK o TURNO_CONFIRMADO**
- 📞 **Registrar Contacto Cliente** (para seguimiento)
- 🏥 **Registrar Contacto Centro Médico**
- 📅 **Asignar Turno** (si no hay turno)
- 🔄 **Reprogramar Turno** (si ya hay turno)

**Estado: SEGUIMIENTO_PRE_TURNO**
- 📞 **Registrar Contacto Cliente**
- 🏥 **Registrar Contacto Centro Médico**
- 🔄 **Reprogramar Turno**

**Estado: TURNO_CONFIRMADO (con turno asignado)**
- ✅ **Marcar Estudio Realizado** (solo si hay turno)

---

### **PASO 4: Registrar Comunicación**

1. Haces clic en **"📞 Registrar Contacto Cliente"** o **"🏥 Registrar Contacto Centro Médico"**
2. Se abre un **formulario** con:
   - **Canal:** Teléfono, Email, WhatsApp, Presencial, Otro
   - **Resultado:** Satisfactorio, Insatisfactorio, Sin Respuesta, Rechazo
   - **Motivo de Falla:** (solo si resultado es Insatisfactorio o Rechazo)
   - **Detalle:** Texto libre con lo que pasó
3. Haces clic en **"Guardar"**
4. **Automáticamente:**
   - ✅ Se crea registro en `comunicaciones`
   - ✅ Se actualiza el estado de la gestión:
     - Si era `PENDIENTE_CONTACTO_CLIENTE` y resultado es `SATISFACTORIO` → `CONTACTO_CLIENTE_OK`
     - Si resultado es `INSATISFACTORIO` → `CONTACTO_CLIENTE_FALLIDO`
     - Si ya había contacto OK → `SEGUIMIENTO_PRE_TURNO`
   - ✅ El Drawer se actualiza mostrando la nueva comunicación en el timeline

---

### **PASO 5: Asignar Turno**

1. Haces clic en **"📅 Asignar Turno"**
2. Se abre un **formulario** con:
   - **Centro Médico:** Nombre del centro
   - **Fecha:** Date picker
   - **Hora:** Time picker
3. Haces clic en **"Guardar"**
4. **Automáticamente:**
   - ✅ Se actualiza `centro_medico` y `turno_fecha_hora` en la gestión
   - ✅ Estado → `TURNO_CONFIRMADO`
   - ✅ El Drawer se actualiza mostrando el turno

---

### **PASO 6: Seguimiento**

Después de asignar el turno:

1. Cada vez que registras una comunicación, se agrega al **timeline**
2. El estado puede cambiar a `SEGUIMIENTO_PRE_TURNO`
3. Puedes ver todas las comunicaciones en orden cronológico
4. Si el turno se vence, el semáforo se pone en **ROJO**

---

### **PASO 7: Marcar Estudio Realizado**

1. Cuando el estudio se realizó, haces clic en **"✅ Marcar Estudio Realizado"**
2. Aparece confirmación: "¿Marcar el estudio como realizado?"
3. Confirmas
4. **Automáticamente:**
   - ✅ Se actualiza `fecha_estudio_realizado`
   - ✅ Estado → `ESTUDIO_REALIZADO`
   - ✅ Se genera notificación a "Francisco" (si existe) o al emisor de la orden
   - ✅ El botón desaparece (ya no se puede marcar de nuevo)

---

## 🔄 Estados del Workflow

```
NUEVA (orden creada)
  ↓
PENDIENTE_CONTACTO_CLIENTE (gestión creada)
  ↓
CONTACTO_CLIENTE_OK (si contacto satisfactorio)
  o
CONTACTO_CLIENTE_FALLIDO (si contacto insatisfactorio - permite reintentos)
  ↓
TURNO_CONFIRMADO (cuando se asigna turno)
  ↓
SEGUIMIENTO_PRE_TURNO (durante seguimiento)
  ↓
ESTUDIO_REALIZADO (cuando se marca como realizado)
```

---

## 📊 Semáforo SLA

El semáforo en la tabla indica urgencia. La lógica canónica está en `lib/semaforo.ts` (`colorOrdenMedica`).

### Flujo activo (gestión en curso)

Cuenta **horas** desde la última comunicación registrada, o desde la creación de la gestión si no hay comunicaciones:

- **🟢 VERDE:** 0–23 h sin contacto
- **🟡 AMARILLO:** 24–47 h sin contacto
- **🔴 ROJO:** ≥ 48 h sin contacto

**Turno vencido:** si `turno_fecha_hora` es anterior a ahora, el semáforo pasa a **ROJO** aunque hayan pasado menos de 48 h (motivo `turno_vencido`).

### Estudio realizado

Reloj congelado en `fecha_estudio_realizado`. Cuenta **días** desde la creación de la gestión:

- **🟢 VERDE:** 0–19 días
- **🟡 AMARILLO:** 20–49 días
- **🔴 ROJO:** ≥ 50 días

### Renunciado

Semáforo **ROJO** fijo. Días congelados entre creación y fecha de renuncia/congelado (columna SLA: «N días (renunciado)»).

---

## 💡 Tips de Uso

1. **Si no ves botones de acción:**
   - Verifica que la orden tenga una gestión asociada
   - Si dice "Sin gestión", haz clic en "➕ Crear Gestión"

2. **Para registrar múltiples contactos:**
   - Cada contacto se registra por separado
   - Todos aparecen en el timeline en orden cronológico

3. **Para reprogramar un turno:**
   - Haz clic en "🔄 Reprogramar Turno"
   - Completa el formulario con nueva fecha/hora
   - Se actualiza automáticamente

4. **Para ver el historial completo:**
   - Todas las comunicaciones aparecen en la sección "Comunicaciones" del Drawer
   - Se muestran en orden cronológico (más reciente primero)

---

## ❓ Preguntas Frecuentes

**P: ¿Por qué no veo botones de acción?**
R: La orden no tiene gestión asociada. Haz clic en "➕ Crear Gestión".

**P: ¿Puedo registrar comunicaciones sin tener turno?**
R: Sí, puedes registrar contactos en cualquier momento.

**P: ¿Qué pasa si marco "Insatisfactorio" en un contacto?**
R: El estado cambia a `CONTACTO_CLIENTE_FALLIDO`, pero puedes intentar de nuevo registrando otro contacto.

**P: ¿Cómo sé si un turno está vencido?**
R: El semáforo se pone en ROJO y aparece "turno_vencido: true" en los datos.

**P: ¿Quién recibe la notificación cuando se marca estudio realizado?**
R: Se busca al usuario "Francisco", si no existe, se notifica al usuario que emitió la orden.

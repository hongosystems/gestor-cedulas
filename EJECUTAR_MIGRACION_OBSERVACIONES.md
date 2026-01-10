# 🔧 Ejecutar Migración: Agregar Columna Observaciones

## ⚠️ IMPORTANTE: Debes ejecutar esta migración SQL en Supabase

Para resolver el error `column expedientes.observaciones does not exist`, ejecuta el siguiente SQL en el **SQL Editor de Supabase**:

### 📝 Paso 1: Abrir SQL Editor en Supabase
1. Ve a tu proyecto en Supabase Dashboard
2. Navega a **SQL Editor** (menú lateral izquierdo)
3. Haz clic en **New query**

### 📝 Paso 2: Ejecutar la Migración

Copia y pega el siguiente SQL:

```sql
-- Migración: Agregar campo observaciones a la tabla expedientes
ALTER TABLE expedientes
ADD COLUMN IF NOT EXISTS observaciones TEXT DEFAULT NULL;
```

### 📝 Paso 3: Verificar

Ejecuta esta consulta para verificar que la columna se creó correctamente:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'expedientes' 
  AND column_name = 'observaciones';
```

Deberías ver una fila con:
- `column_name`: `observaciones`
- `data_type`: `text`
- `is_nullable`: `YES`

### ✅ Después de ejecutar

Una vez ejecutada la migración, recarga la página de "Mis Expedientes" y el error debería desaparecer. Las observaciones funcionarán correctamente.

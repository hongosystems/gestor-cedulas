# Gestor de Cédulas/Oficios

Sistema completo de gestión de cédulas, oficios y expedientes con sistema de semáforo automático por antigüedad, dashboard de métricas y gestión de usuarios.

---

## 📋 Tabla de Contenidos

1. [Información Técnica](#información-técnica)
2. [URLs de Producción](#urls-de-producción)
3. [Acceso y Credenciales](#acceso-y-credenciales)
4. [Roles y Permisos](#roles-y-permisos)
5. [Rutas y Accesos](#rutas-y-accesos)
6. [Instalación y Desarrollo](#instalación-y-desarrollo)
7. [Variables de Entorno](#variables-de-entorno)
8. [Estructura del Proyecto](#estructura-del-proyecto)
9. [Deployment](#deployment)
10. [Características Principales](#características-principales)

---

## 🔧 Información Técnica

### Stack Tecnológico

**Frontend:**
- **Framework:** Next.js 16.1.1 (App Router)
- **Lenguaje:** TypeScript 5.x
- **UI Library:** React 19.2.3
- **Estilos:** CSS Modules + CSS Global
- **Generación de PDFs:** jsPDF 4.0.0

**Backend:**
- **Runtime:** Node.js 18+ (Serverless Functions en Vercel)
- **API Routes:** Next.js API Routes (TypeScript)
- **Autenticación:** Supabase Auth (JWT)

**Base de Datos:**
- **Principal:** Supabase (PostgreSQL)
- **Storage:** Supabase Storage (bucket `cedulas`)
- **Secundaria (opcional):** Supabase pjn-scraper (para autocompletado de expedientes)

**Infraestructura:**
- **Hosting:** Vercel (Serverless)
- **CI/CD:** Automático vía Git push a `main`
- **Build:** Next.js Build System
- **Node Version:** 18.x o superior

**Dependencias Principales:**
- `@supabase/supabase-js` ^2.89.0 - Cliente de Supabase
- `mammoth` ^1.11.0 - Extracción de texto desde DOCX
- `pdf-parse` ^2.4.5 - Análisis de PDFs
- `jspdf` ^4.0.0 - Generación de PDFs

---

## 🌐 URLs de Producción

### Vercel

**URL Principal de Producción:**
```
https://gestor-cedulas.vercel.app
```

**Dashboard de Vercel:**
```
https://vercel.com/dashboard
```

**URLs de Preview (despliegues automáticos por branch):**
```
https://[TU-PROYECTO]-[BRANCH].vercel.app
```

---

## 🔐 Acceso y Credenciales

### Lista de Usuarios y Roles

| Email | Nombre | Rol | Contraseña Inicial | Acceso |
|-------|--------|-----|-------------------|--------|
| `gfhisi@gmail.com` | Gustavo Hisi | SuperAdmin | `Contraseña1995!` | Dashboard completo + WebMaster |
| `ifran_jorge@hotmail.com` | Jorge Alejandro Ifran | SuperAdmin | `Contraseña1995!` | Dashboard completo + WebMaster |
| `andreaestudio24@gmail.com` | Andrea Villan | Admin Cédulas | `hola123` | Gestión de cédulas/oficios |
| `micaelaestudio01@gmail.com` | Micaela Heinrich | Admin Cédulas | `hola123` | Gestión de cédulas/oficios |
| `autorizadosestudiohif@gmail.com` | Gabriel Crespo | Admin Cédulas | `hola123` | Gestión de cédulas/oficios |
| `mf.magaliflores@gmail.com` | Magali Flores | Admin Cédulas | `hola123` | Gestión de cédulas/oficios |
| `novedadesgh@outlook.com` | Francisco Querinuzzi | Admin Cédulas | `hola123` | Gestión de cédulas/oficios |
| `victoria.estudiohisi@gmail.com` | Guido Querinuzzi | Admin Cédulas | `hola123` | Gestión de cédulas/oficios |
| `maggiecollado@gmail.com` | Maggie Collado | Admin Cédulas | `hola123` | Gestión de cédulas/oficios |

**Nota:** Todos los usuarios deben cambiar su contraseña en el primer acceso.

### Usuarios Abogados

Los usuarios con rol **Abogado** tienen acceso a expedientes, cédulas y oficios de sus juzgados asignados. Se crean y gestionan desde el panel WebMaster.

---

## 👥 Roles y Permisos

### 1. SuperAdmin (`is_superadmin = TRUE`)

**Acceso Completo:**
- ✅ Dashboard de métricas (`/superadmin`)
- ✅ Panel WebMaster (`/webmaster`) - Gestión completa de usuarios
- ✅ Mis Juzgados (`/superadmin/mis-juzgados`) - Ver todos los datos
- ✅ Configuración (`/superadmin/config`)
- ✅ Gestión de expedientes (`/app/expedientes`)
- ✅ Gestión de cédulas/oficios (`/app`)
- ✅ Generación de reportes PDF

**Capacidades:**
- Ver todos los datos sin restricciones
- Crear, editar y eliminar usuarios
- Asignar roles y juzgados
- Acceder a todos los archivos

### 2. Admin Cédulas (`is_admin_cedulas = TRUE`)

**Acceso:**
- ✅ Gestión de cédulas/oficios (`/app`)
- ✅ Crear nuevas cédulas (`/app/nueva`)
- ✅ Ver y gestionar sus propias cédulas

**Restricciones:**
- ❌ No puede acceder al dashboard
- ❌ No puede gestionar usuarios
- ❌ No puede ver expedientes

### 3. Admin Expedientes (`is_admin_expedientes = TRUE`)

**Acceso:**
- ✅ Gestión de expedientes (`/app/expedientes`)
- ✅ Crear nuevos expedientes (`/app/expedientes/nueva`)
- ✅ Ver y editar expedientes
- ✅ Ver observaciones

**Restricciones:**
- ❌ No puede acceder al dashboard
- ❌ No puede gestionar usuarios
- ❌ Acceso limitado a cédulas (solo propias)

### 4. Abogado (`is_abogado = TRUE`)

**Acceso:**
- ✅ Vista de expedientes de juzgados asignados (`/app/abogado`)
- ✅ Vista de Mis Juzgados (`/superadmin/mis-juzgados`)
- ✅ Ver y abrir cédulas/oficios de sus juzgados (`VER CÉDULA` / `VER OFICIO`)
- ✅ Ver expedientes de sus juzgados asignados

**Restricciones:**
- ❌ Solo puede ver datos de sus juzgados asignados
- ❌ No puede crear ni editar expedientes
- ❌ No puede gestionar usuarios
- ❌ No puede acceder al dashboard completo

**Nota:** Los abogados pueden tener múltiples juzgados asignados en la tabla `user_juzgados`.

---

## 🗺️ Rutas y Accesos

### Rutas Públicas

| Ruta | Descripción | Acceso |
|------|-------------|--------|
| `/` | Página de inicio | Redirige según rol |
| `/login` | Página de login | Público |
| `/logout` | Cerrar sesión | Autenticado |
| `/select-role` | Selección de rol (solo para roles no-abogado/no-superadmin) | Autenticado con múltiples roles |
| `/cambiar-password` | Cambio de contraseña obligatorio | Autenticado (si `must_change_password = true`) |

### Rutas de Gestión de Cédulas/Oficios

| Ruta | Descripción | Roles con Acceso |
|------|-------------|------------------|
| `/app` | Lista de cédulas/oficios | Admin Cédulas, SuperAdmin |
| `/app/nueva` | Crear nueva cédula/oficio | Admin Cédulas, SuperAdmin |

### Rutas de Gestión de Expedientes

| Ruta | Descripción | Roles con Acceso |
|------|-------------|------------------|
| `/app/expedientes` | Lista de expedientes | Admin Expedientes, Abogado, SuperAdmin |
| `/app/expedientes/nueva` | Crear nuevo expediente | Admin Expedientes, SuperAdmin |
| `/app/expedientes/[id]` | Detalle de expediente | Admin Expedientes, SuperAdmin |

### Rutas de Abogado

| Ruta | Descripción | Roles con Acceso |
|------|-------------|------------------|
| `/app/abogado` | Vista de expedientes de juzgados asignados | Abogado, SuperAdmin |

### Rutas de SuperAdmin

| Ruta | Descripción | Roles con Acceso |
|------|-------------|------------------|
| `/superadmin` | Dashboard de métricas y KPIs | SuperAdmin |
| `/superadmin/mis-juzgados` | Vista de expedientes, cédulas y oficios por juzgado | SuperAdmin, Abogado |
| `/superadmin/config` | Configuración de reportes | SuperAdmin |

### Rutas de WebMaster

| Ruta | Descripción | Roles con Acceso |
|------|-------------|------------------|
| `/webmaster/login` | Login del panel WebMaster | SuperAdmin |
| `/webmaster` | Gestión de usuarios (CRUD completo) | SuperAdmin |

### API Routes (Backend)

| Endpoint | Método | Descripción | Autenticación |
|----------|--------|-------------|---------------|
| `/api/detect-type` | GET | Detectar tipo de documento (CÉDULA/OFICIO) | No requerida |
| `/api/detect-type-upload` | POST | Detectar tipo desde archivo subido | No requerida |
| `/api/extract-caratula` | POST | Extraer carátula desde DOCX | No requerida |
| `/api/extract-juzgado` | POST | Extraer juzgado desde DOCX | No requerida |
| `/api/extract-pdf` | POST | Extraer texto desde PDF | No requerida |
| `/api/open-file` | GET | Abrir archivo PDF/DOCX | JWT Token requerido |
| `/api/search-expediente-pjn` | POST | Buscar expediente en pjn-scraper | No requerida |
| `/api/fetch-expediente-pjn` | POST | Obtener datos completos de expediente | No requerida |
| `/api/pjn-login` | POST | Login a sistema PJN | No requerida |
| `/api/pjn-update-cookies` | POST | Actualizar cookies de PJN | No requerida |
| `/api/webmaster/users` | GET, POST | Listar y crear usuarios | SuperAdmin |
| `/api/webmaster/users/[userId]` | GET, PUT, DELETE | Obtener, actualizar, eliminar usuario | SuperAdmin |

---

## 🚀 Instalación y Desarrollo

### Requisitos Previos

- Node.js 18.x o superior
- npm o yarn
- Git

### Instalación

```bash
# Clonar el repositorio
git clone [URL_DEL_REPOSITORIO]
cd gestor-cedulas

# Instalar dependencias
npm install

# Configurar variables de entorno (ver sección Variables de Entorno)
cp .env.example .env.local
# Editar .env.local con tus credenciales
```

### Desarrollo Local

```bash
# Iniciar servidor de desarrollo
npm run dev

# El servidor estará disponible en:
# http://localhost:3000
```

### Scripts Disponibles

```bash
# Desarrollo
npm run dev          # Iniciar servidor de desarrollo

# Producción
npm run build        # Compilar para producción
npm start            # Ejecutar versión compilada

# Calidad de Código
npm run lint         # Ejecutar linter

# Scripts PJN (opcionales)
npm run pjn:login    # Login a sistema PJN
npm run pjn:check    # Verificar conexión PJN
```

---

## 🔑 Variables de Entorno

### Variables Requeridas

Crea un archivo `.env.local` en la raíz del proyecto:

```env
# ============================================
# BASE DE DATOS PRINCIPAL (Supabase)
# ============================================
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_anon_key_aqui
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key_aqui

# ============================================
# BASE DE DATOS PJN-SCRAPER (Opcional)
# Requerida para autocompletado de expedientes
# ============================================
NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL=https://pjn-scraper.supabase.co
NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY=tu_anon_key_pjn_scraper
PJN_SCRAPER_TABLE_NAME=cases  # Opcional, por defecto: "cases"
```

### Variables en Vercel

Configura estas variables en **Vercel Dashboard → Settings → Environment Variables**:

1. Marca todas para: **Production**, **Preview**, **Development**
2. Agrega todas las variables listadas arriba
3. **IMPORTANTE:** `SUPABASE_SERVICE_ROLE_KEY` es secreta y solo se usa en el servidor

---

## 📁 Estructura del Proyecto

```
gestor-cedulas/
├── app/                          # Next.js App Router
│   ├── api/                      # API Routes (Backend)
│   │   ├── detect-type/          # Detección de tipo de documento
│   │   ├── detect-type-upload/   # Detección desde upload
│   │   ├── extract-caratula/     # Extracción de carátula (DOCX)
│   │   ├── extract-juzgado/      # Extracción de juzgado (DOCX)
│   │   ├── extract-pdf/           # Extracción de texto (PDF)
│   │   ├── open-file/             # Servir archivos con autenticación
│   │   ├── search-expediente-pjn/ # Búsqueda en pjn-scraper
│   │   ├── fetch-expediente-pjn/  # Obtener datos completos de expediente
│   │   ├── pjn-login/             # Login a sistema PJN
│   │   ├── pjn-update-cookies/    # Actualizar cookies PJN
│   │   └── webmaster/             # API de gestión de usuarios
│   │       └── users/
│   │           ├── route.ts       # GET, POST usuarios
│   │           └── [userId]/      # GET, PUT, DELETE usuario específico
│   │               └── route.ts
│   ├── app/                       # Páginas de aplicación
│   │   ├── page.tsx               # Lista de cédulas/oficios
│   │   ├── nueva/                  # Crear nueva cédula/oficio
│   │   ├── abogado/                # Vista de abogado
│   │   └── expedientes/            # Gestión de expedientes
│   │       ├── page.tsx            # Lista de expedientes
│   │       ├── nueva/              # Crear nuevo expediente
│   │       └── [id]/               # Detalle de expediente
│   ├── login/                      # Página de login
│   ├── logout/                     # Cerrar sesión
│   ├── select-role/                # Selección de rol
│   ├── cambiar-password/           # Cambio de contraseña
│   ├── superadmin/                 # Panel de SuperAdmin
│   │   ├── page.tsx                # Dashboard principal
│   │   ├── config/                 # Configuración
│   │   └── mis-juzgados/           # Vista por juzgados
│   ├── webmaster/                  # Panel WebMaster
│   │   ├── login/                  # Login WebMaster
│   │   └── page.tsx                 # Gestión de usuarios
│   ├── layout.tsx                  # Layout principal
│   └── globals.css                 # Estilos globales
├── lib/                            # Librerías y utilidades
│   ├── supabase.ts                 # Cliente Supabase principal
│   ├── pjn-scraper-supabase.ts     # Cliente Supabase pjn-scraper
│   └── semaforo.ts                 # Lógica del semáforo
├── migrations/                     # Migraciones SQL
│   ├── add_admin_cedulas.sql
│   ├── add_abogado_role_and_juzgados.sql
│   ├── add_observaciones_to_expedientes.sql
│   └── ...
├── scripts/                        # Scripts de utilidad
│   ├── create_users.mjs           # Crear usuarios iniciales
│   └── pjn-scraper.ts              # Scripts de PJN
├── chrome-extension/               # Extensión de Chrome (PJN Sync)
├── pdf-extractor-service/          # Servicio de extracción de PDFs
├── package.json                    # Dependencias y scripts
├── tsconfig.json                   # Configuración TypeScript
├── next.config.ts                  # Configuración Next.js
└── README.md                       # Este archivo
```

---

## 🚀 Deployment

### Vercel (Producción)

El proyecto está configurado para deployment automático en Vercel:

1. **Repositorio conectado:** El repositorio Git está vinculado a Vercel
2. **Deploy automático:** Cada push a `main` genera un nuevo deployment
3. **Variables de entorno:** Configuradas en Vercel Dashboard

**Pasos para Deployment Manual:**

1. Ve a [Vercel Dashboard](https://vercel.com/dashboard)
2. Selecciona el proyecto
3. Ve a **Deployments**
4. Haz clic en **Redeploy** en el deployment más reciente

**Verificar Deployment:**

- ✅ Build exitoso (verde en dashboard)
- ✅ Sin errores en logs
- ✅ Aplicación accesible en la URL de producción

### Configuración de Build en Vercel

- **Framework Preset:** Next.js (detectado automáticamente)
- **Build Command:** `npm run build` (automático)
- **Output Directory:** `.next` (automático)
- **Install Command:** `npm install` (automático)
- **Node.js Version:** 18.x (configurado en Vercel)

---

## ✨ Características Principales

### 1. Gestión de Cédulas y Oficios

- ✅ Carga de archivos PDF/DOCX
- ✅ Autorrelleno automático desde DOCX (carátula, juzgado)
- ✅ Detección automática de tipo (CÉDULA/OFICIO)
- ✅ Sistema de semáforo por antigüedad
- ✅ Visualización de archivos en el navegador
- ✅ Ordenamiento por semáforo, días, fecha

### 2. Gestión de Expedientes

- ✅ Creación y edición de expedientes
- ✅ Autocompletado desde base de datos pjn-scraper
- ✅ Campo de observaciones con formato mejorado
- ✅ Filtrado por juzgado
- ✅ Vista de "Cargado por" (usuario que creó el expediente)

### 3. Dashboard de Métricas (SuperAdmin)

- ✅ KPIs en tiempo real
- ✅ Métricas por tipo (cédulas, oficios, expedientes)
- ✅ Rendimiento por usuario
- ✅ Estados por semáforo (rojo, amarillo, verde)
- ✅ Generación de reportes PDF profesionales
- ✅ Filtros por fecha y usuario

### 4. Sistema de Roles y Permisos

- ✅ 4 roles diferentes (SuperAdmin, Admin Cédulas, Admin Expedientes, Abogado)
- ✅ Control de acceso granular por ruta
- ✅ Asignación de juzgados a abogados
- ✅ Gestión de usuarios desde WebMaster

### 5. Panel WebMaster

- ✅ CRUD completo de usuarios
- ✅ Asignación de roles
- ✅ Asignación de juzgados a abogados
- ✅ Cambio de contraseñas
- ✅ Visualización de roles activos

### 6. Vista de Abogados

- ✅ Acceso a expedientes de juzgados asignados
- ✅ Acceso a cédulas/oficios de juzgados asignados
- ✅ Botones "VER CÉDULA" / "VER OFICIO" para abrir archivos
- ✅ Filtrado automático por juzgados

### 7. Sistema de Semáforo

- 🟢 **VERDE:** 0-29 días desde última modificación/carga
- 🟡 **AMARILLO:** 30-59 días
- 🔴 **ROJO:** 60+ días

### 8. Integración con PJN

- ✅ Autocompletado de expedientes desde pjn-scraper
- ✅ Extracción de carátula, juzgado, fecha y observaciones
- ✅ Extensión de Chrome para sincronización

---

## 🔒 Seguridad

### Autenticación

- **Método:** Supabase Auth (JWT)
- **Sesiones:** Manejo automático por Supabase
- **Tokens:** JWT con expiración automática

### Control de Acceso

- **RLS (Row Level Security):** Implementado en Supabase
- **Verificación de roles:** En cada ruta protegida
- **Permisos de archivos:** Verificación por `owner_user_id` o juzgado asignado

### Almacenamiento de Archivos

- **Ubicación:** Supabase Storage (bucket `cedulas`)
- **Estructura:** `{user_id}/{cedula_id}.{ext}`
- **Permisos:** Solo el dueño o abogados con juzgado asignado pueden acceder

### Variables de Entorno

- **Públicas:** `NEXT_PUBLIC_*` (accesibles desde el cliente)
- **Secretas:** `SUPABASE_SERVICE_ROLE_KEY` (solo servidor)
- **Nunca commiteadas:** `.env.local` está en `.gitignore`

---

## 📊 Base de Datos

### Tablas Principales

**`profiles`**
- `id` (UUID, FK a auth.users)
- `email` (text)
- `full_name` (text)
- `must_change_password` (boolean)

**`user_roles`**
- `user_id` (UUID, FK a auth.users)
- `is_superadmin` (boolean)
- `is_admin_cedulas` (boolean)
- `is_admin_expedientes` (boolean)
- `is_abogado` (boolean)

**`user_juzgados`**
- `user_id` (UUID, FK a auth.users)
- `juzgado` (text)

**`cedulas`**
- `id` (UUID)
- `owner_user_id` (UUID)
- `caratula` (text)
- `juzgado` (text)
- `fecha_carga` (timestamp)
- `estado` (text)
- `pdf_path` (text)
- `tipo_documento` (text: "CEDULA" | "OFICIO" | null)
- `created_by_user_id` (UUID)

**`expedientes`**
- `id` (UUID)
- `owner_user_id` (UUID)
- `caratula` (text)
- `juzgado` (text)
- `numero_expediente` (text)
- `fecha_ultima_modificacion` (timestamp)
- `estado` (text)
- `observaciones` (text)
- `created_by_user_id` (UUID)

### Storage

**Bucket:** `cedulas`
- Estructura: `{user_id}/{cedula_id}.{ext}`
- Formatos soportados: PDF, DOCX, DOC
- Políticas RLS configuradas

---

## 🛠️ Migraciones SQL

Las migraciones se encuentran en la carpeta `migrations/` y deben ejecutarse en Supabase SQL Editor en orden:

1. `add_superadmin_cedulas_rls.sql` - Políticas RLS para SuperAdmin
2. `add_abogado_role_and_juzgados.sql` - Rol Abogado y tabla user_juzgados
3. `add_admin_cedulas.sql` - Rol Admin Cédulas
4. `add_observaciones_to_expedientes.sql` - Campo observaciones
5. `add_created_by_to_cedulas.sql` - Campo created_by_user_id
6. `add_tipo_documento.sql` - Campo tipo_documento

**Ejecutar migraciones:**
1. Ve a Supabase Dashboard → SQL Editor
2. Copia y pega el contenido de cada migración
3. Ejecuta en orden
4. Verifica que no haya errores

---

## 📝 Notas Importantes

### Primer Acceso

- Todos los usuarios deben cambiar su contraseña en el primer acceso
- El sistema redirige automáticamente a `/cambiar-password` si `must_change_password = true`

### Múltiples Roles

- Si un usuario tiene múltiples roles **y NO es Abogado ni Superadmin**, se redirige a `/select-role` para elegir
- Si el usuario es **Abogado o Superadmin**, entra directo a `/superadmin` (sin pantalla intermedia)
- Los SuperAdmins pueden acceder a todo sin selección

### Abogados y Juzgados

- Los abogados solo ven datos de sus juzgados asignados
- La comparación de juzgados es flexible (normaliza mayúsculas y espacios)
- Los abogados pueden abrir archivos de otros usuarios si pertenecen a sus juzgados

### Generación de PDFs

- El botón "Imprimir" en el dashboard genera un PDF con toda la información actual
- El PDF incluye métricas, rendimiento por usuario y desglose por tipo
- Se descarga automáticamente con nombre: `dashboard-reporte-YYYY-MM-DD.pdf`

---

## 🐛 Troubleshooting

### Error: "Variables de entorno no encontradas"
- Verifica que todas las variables estén en `.env.local` (local) o Vercel (producción)
- Reinicia el servidor después de agregar variables

### Error: "No tienes permisos para acceder a este archivo"
- Verifica que el usuario tenga el rol correcto
- Para abogados, verifica que el juzgado esté asignado en `user_juzgados`

### Error: "Columna no existe" (observaciones, tipo_documento, etc.)
- Ejecuta las migraciones SQL correspondientes en Supabase

### Error: Build falla en Vercel
- Verifica versión de Node.js (debe ser 18+)
- Revisa logs de build en Vercel Dashboard
- Ejecuta `npm run build` localmente para ver errores

---

## 📞 Soporte

Para problemas o preguntas:
- Revisa los logs en Vercel Dashboard
- Verifica las migraciones SQL en Supabase
- Contacta al equipo de desarrollo

---

## 📄 Licencia

Proyecto privado - Todos los derechos reservados.

---

**Última actualización:** Enero 2026

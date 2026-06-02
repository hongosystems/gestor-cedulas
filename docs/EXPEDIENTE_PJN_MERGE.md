# Merge expedientes manuales ↔ PJN Favoritos

## Qué hace

En **Mis Juzgados**, los expedientes cargados a mano en `expedientes` se enlazan por número/año/jurisdicción con `pjn_favoritos`. Si hay coincidencia:

- Se rellenan huecos: `juzgado`, `observaciones`, `fecha_ultima_modificacion` (la más reciente gana).
- El favorito **no** se muestra como segunda fila (sin duplicados).
- Se conservan notas, `created_by` y el `id` local.

## Rollback

### 1. Sin tocar código (inmediato)

En Vercel / `.env.local`:

```env
NEXT_PUBLIC_EXPEDIENTE_PJN_MERGE=0
```

Redeploy o reiniciar `npm run dev`. Vuelve el comportamiento anterior (lista local + favoritos por separado).

### 2. Git

Tag creado antes del cambio:

```bash
git checkout pre-expediente-pjn-merge
```

O revertir solo el merge en la rama:

```bash
git revert <commit-del-merge>
```

Rama de trabajo: `feature/expediente-pjn-merge`.

## Archivos

| Archivo | Rol |
|---------|-----|
| `lib/expediente-pjn-merge.ts` | Lógica de match y merge |
| `app/superadmin/mis-juzgados/page.tsx` | Integración en carga de expedientes |
| `scripts/test-expediente-pjn-merge.mjs` | Prueba local (35586/2025) |

## Prueba local

```bash
node scripts/test-expediente-pjn-merge.mjs
```

## Caso de referencia

- Manual: `35586/2025`, sin juzgado/observaciones, fecha 10/02/2026.
- PJN: `CIV 035586/2025`, Juzgado Civil 55, actuaciones mayo 2026.
- Clave de match: `CIV|35586|2025`.

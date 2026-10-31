---
'@eva_solutions/auth-sdk': minor
---

BFF route for the active company, and the products admin API.

- `evaAuthRoutes` and `evaAuthOpenAPIRoutes` gain `POST /empresa-activa` (`{ empresaId | null }`): it uses the product access cookie, calls `POST /api/v1/auth/empresa-activa` and rewrites ONLY the access cookie with the re-issued token (the refresh token does not rotate). Errors from Auth (401, 403) use the BFF error format. `createHttpClient().setActiveEmpresa()` returns `{ empresaId, accessToken }`.
- Contract: `GET/POST /admin/productos` and `PATCH /admin/productos/{slug}` (no delete: a product is disabled) with `productoSchema`, `createProductoRequestSchema`, `updateProductoRequestSchema`, `listProductosResponseSchema` and `productoResponseSchema`. The admin client gains `listProductos()`, `createProducto({ slug, nombre, enabled? })` and `updateProducto(slug, { nombre?, enabled? })`.

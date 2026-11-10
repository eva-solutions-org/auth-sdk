---
'@eva_solutions/auth-sdk': minor
---

`AdminClient.maintenanceCleanup` and `allowedOrigins` for native app schemes.

- New `AdminClient.maintenanceCleanup({ limit? })` for `POST /api/v1/admin/maintenance/cleanup`, signed with HMAC like the other admin methods. On demand, it purges the `eliminado` accounts whose restore window has expired and deletes the `webhook_events` that have no live deliveries and exceed the retention. `limit` (1 to 100, default 100) travels in the signed query string. It returns `{ usersPurged, eventsDeleted, hasMore }`; call again while `hasMore` is true.
- Contract: `ADMIN_ROUTES.maintenanceCleanup`, `maintenanceCleanupQuerySchema` and `maintenanceCleanupResponseSchema` (+ `MaintenanceCleanupQuery`, `MaintenanceCleanupResponse`). New admin entry point types `MaintenanceCleanupQuery` and `MaintenanceCleanupResult`.
- `allowedOrigins` of `evaAuthRoutes` / `evaAuthOpenAPIRoutes` accepts any serialized origin (`scheme://host[:port]`), not only `http(s)`: `tauri://localhost` or `capacitor://localhost` now pass the `Origin` check by exact match. `'*'`, `null` and entries with path, userinfo or an invalid port still throw when the routes are built.

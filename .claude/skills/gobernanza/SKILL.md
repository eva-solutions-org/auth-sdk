---
name: gobernanza
description: Índice maestro de skills del SDK @eva/auth-sdk. Carga este skill primero para saber qué otros skills cargar según la tarea.
user-invocable: true
---

## Stack del proyecto

- **Runtime**: Edge + Node.js
- **Build**: tsdown (ESM+CJS+DTS), target ES2022
- **Lenguaje**: TypeScript (strict: true)
- **JWT**: jose v6 (ES256)
- **UA Parsing**: bowser
- **Peer deps**: hono >=4.0.0, react >=18.0.0 (ambos opcionales)
- **Testing**: Vitest
- **Lint**: oxlint

## Índice de skills

Cargar SOLO los skills necesarios para la tarea actual:

| Estoy haciendo... | Cargar skill |
|-------------------|--------------|
| Crear/modificar archivos en src/, naming, patterns | `auth-sdk-dev` |
| Cookies, tokens, JWT, headers, endpoints de auth | `auth-sdk-security` |
| Entender estructura, módulos, entry points, flujo | `arquitectura` |
| Consultar exports, tipos, funciones, hooks | `api` |
| Variables de entorno, cookies config, setup | `configuracion` |
| Cambiar comportamiento establecido, ADRs | `decisiones` |

### Combinaciones frecuentes

| Tarea | Skills a cargar |
|-------|----------------|
| Nuevo endpoint en auth-routes | `auth-sdk-dev` + `auth-sdk-security` + `api` |
| Nuevo hook en react/ | `auth-sdk-dev` + `api` |
| Modificar middleware o refresh | `auth-sdk-security` + `decisiones` |
| Setup inicial del SDK | `configuracion` + `arquitectura` |
| Feature nueva completa | `arquitectura` + `auth-sdk-dev` + `auth-sdk-security` |

## Fuente de verdad

Cada skill referencia su documento en `docs/`. Los docs son la fuente de verdad única — los skills son thin wrappers que apuntan a ellos.

| Skill | Documento |
|-------|-----------|
| `auth-sdk-dev` | `docs/conventions.md` |
| `auth-sdk-security` | `docs/security.md` |
| `arquitectura` | `docs/architecture.md` |
| `api` | `docs/api.md` |
| `configuracion` | `docs/configuration.md` |
| `decisiones` | `docs/decisions.md` |

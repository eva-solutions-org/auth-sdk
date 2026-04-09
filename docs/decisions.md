# Registro de decisiones

Formato ADR simplificado. Cada entrada documenta una decisión de diseño del SDK, su contexto y la justificación.

---

## ADR-001: Error propagation transparente

**Fecha**: 2026-04-09
**Estado**: Aceptada

### Contexto

El SDK actúa como proxy entre el frontend y el Auth Service. Los mensajes de error del Auth Service están diseñados para ser útiles al usuario final.

### Decisión

Los errores del Auth Service se propagan **sin sanitizar** al frontend. El SDK no modifica, oculta ni reemplaza mensajes de error.

### Justificación

- El consumidor conoce su propio Auth Service y controla los mensajes
- Los mensajes son útiles para UX (ej: "Código expirado", "Teléfono no registrado")
- Sanitizar agregaría complejidad sin beneficio real en este contexto

---

## ADR-002: Cookie Secure=true en development

**Fecha**: 2026-04-09
**Estado**: Aceptada

### Contexto

Los entornos de desarrollo modernos suelen tener HTTPS configurado. El flag `Secure` en cookies impide que se envíen por HTTP plano.

### Decisión

`Secure=true` en todos los entornos excepto `NODE_ENV=local`. El valor `development` **no** desactiva Secure.

### Justificación

- Development con HTTPS es lo esperado, no un entorno sin HTTPS
- Solo `local` (desarrollo puramente local sin HTTPS) necesita la excepción
- Esto evita configuraciones inseguras accidentales en staging o pre-producción

---

## ADR-003: Paradigma funcional sin clases

**Fecha**: 2026-04-09
**Estado**: Aceptada

### Contexto

El SDK necesita ser ligero, tree-shakeable y compatible con Edge runtime.

### Decisión

Todo el SDK usa **funciones + objetos**. Sin clases. Result Pattern para errores de negocio. Excepciones solo para errores de programación (ej: middleware no aplicado).

### Justificación

- Las funciones son más simples de componer y testear
- Mejor tree-shaking que clases con métodos
- Result Pattern hace los errores explícitos en el tipo de retorno
- Las excepciones quedan reservadas para bugs reales, no flujos esperados

---

## ADR-004: Auto-refresh con deduplicación

**Fecha**: 2026-04-09
**Estado**: Aceptada

### Contexto

Cuando un access token expira, múltiples requests concurrentes pueden llegar al middleware simultáneamente. Cada una intentaría hacer refresh contra el Auth Service, causando race conditions.

### Decisión

El middleware usa un **`Map<string, Promise>` a nivel de módulo**, keyed por `refreshToken`, para deduplicar refresh requests concurrentes. Solo el primer request para un refresh token dado ejecuta el refresh contra el Auth Service; los demás esperan su resultado.

Este patrón se aplica tanto en `hono/middleware.ts` como en `generic/verify.ts`.

### Justificación

- Evita que múltiples requests usen el mismo refresh token simultáneamente
- El Auth Service podría invalidar un refresh token después del primer uso
- Reduce carga innecesaria contra el Auth Service
- Patrón simple sin necesidad de locks o mutexes
- El Map permite deduplicar por token específico (antes era una variable global compartida)

---

## ADR-005: JWKS cache con hard max TTL

**Fecha**: 2026-04-09
**Estado**: Aceptada

### Contexto

La public key del Auth Service se cachea localmente para evitar fetch en cada verificación. Si el Auth Service rota la key, el SDK debe obtener la nueva.

### Decisión

- TTL normal de refresh: **24 horas**
- Grace period si fetch falla: **1 hora adicional** (25h total)
- Después de 25 horas sin actualización exitosa: **rechazar verificación**

### Justificación

- 24h es suficiente para operación normal sin exceso de requests al JWKS
- 1h de grace period tolera downtime breve del Auth Service
- Después de 25h, usar una key potencialmente revocada es un riesgo de seguridad inaceptable
- Es preferible rechazar requests temporalmente a verificar con una key obsoleta

---

## ADR-006: Constantes build-time vía tsup define

**Fecha**: 2026-04-09
**Estado**: Aceptada (reemplaza versión anterior con env vars runtime)

### Contexto

Originalmente la URL del Auth Service se leía de `process.env.EVA_AUTH_URL` en runtime y `NODE_ENV` controlaba el flag Secure de cookies. Esto exponía detalles de infraestructura al consumidor y requería que el deploy configurara env vars.

### Decisión

La URL y el entorno se **hornean como constantes** en el paquete al momento del build vía `tsup define`. Se usa `EVA_BUILD_ENV` (solo al momento de build) para seleccionar de un map interno de URLs. El consumidor NO configura nada — ni en código, ni en variables de entorno, ni en deploy. Instala la versión correcta del SDK y listo.

Scripts de build: `build:local`, `build:dev`, `build:prod`, `pack:local`.

`config.ts` exporta: `AUTH_URL` (string), `ENV` (EvaEnv), `getAuthUrl()`, `getEvaEnv()` — todas resueltas en build-time. Se eliminaron `configure()`, `resetConfig()`, `getConfig()` y toda lectura de `process.env` en runtime.

### Justificación

- El consumidor no necesita saber la URL del Auth Service ni configurar nada
- Elimina una categoría entera de bugs (env var mal configurada, faltante, o diferente entre deploys)
- Reduce la superficie de API pública
- El SDK se comporta idénticamente en cualquier runtime (Edge, Node, browser) sin depender de `process.env`
- `createEvaAuth()` sin parámetros es más simple de consumir

---

## ADR-007: Cookie Secure por entorno build-time

**Fecha**: 2026-04-09
**Estado**: Aceptada (reemplaza versión anterior con NODE_ENV runtime)

### Contexto

Antes el flag `Secure` se decidía leyendo `NODE_ENV` de `process.env` en runtime. Con la migración a constantes build-time, ya no existe lectura de env vars en runtime.

### Decisión

`isSecureCookie()` usa `getEvaEnv()` (constante horneada en build-time). Solo `local` desactiva Secure; `development` y `production` mantienen `Secure=true`.

### Justificación

- Consistente con el modelo build-time: todo se decide al compilar, no al ejecutar
- Elimina la dependencia de `process.env` en runtime
- Development con HTTPS es lo esperado — solo `local` necesita la excepción
- Evita configuraciones inseguras accidentales en staging o pre-producción

---

## ADR-008: createEvaAuth() como punto de extensión

**Fecha**: 2026-04-09
**Estado**: Aceptada

### Contexto

`createEvaAuth()` actualmente es un wrapper trivial sobre `createHttpClient()`. Podría parecer innecesario.

### Decisión

Se mantiene `createEvaAuth()` como API pública del SDK. Es el punto de entrada intencional para consumidores que necesitan acceso directo al cliente HTTP.

### Justificación

- Provee un punto de extensión estable si el SDK añade configuración futura (logger, rate limiter, plugins)
- La firma sin parámetros es consistente con el modelo build-time (ADR-006)
- `createHttpClient()` es un detalle de implementación; `createEvaAuth()` es la API pública semántica
- El costo es mínimo (una función, una indirección)

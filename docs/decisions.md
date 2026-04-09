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

El middleware usa una **Promise compartida a nivel de módulo** para deduplicar refresh requests concurrentes. Solo el primer request ejecuta el refresh; los demás esperan su resultado.

### Justificación

- Evita que múltiples requests usen el mismo refresh token simultáneamente
- El Auth Service podría invalidar un refresh token después del primer uso
- Reduce carga innecesaria contra el Auth Service
- Patrón simple sin necesidad de locks o mutexes

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

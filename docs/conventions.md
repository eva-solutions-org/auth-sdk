# Convenciones del código

## Paradigma

Funcional puro. Objetos + funciones, **SIN clases**. Toda función exportada es una función regular, no un método de clase.

---

## Result Pattern

Todas las operaciones async retornan `Result<T>`:

```ts
type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number }
```

**NUNCA** throw para flujos de negocio. Los errores se representan como valores.

### Excepciones a la regla

Los helpers de Hono (`getEvaPayload`, `getEvaUser`, `getSessionId`) **sí lanzan** si el middleware `evaAuth()` no está aplicado. Esto es un error de programación, no de negocio.

---

## Error propagation

Los errores del Auth Service se propagan **transparentes** al frontend. El SDK actúa como proxy y **NO sanitiza** mensajes de error. Esto es una decisión intencional — ver [decisions.md](decisions.md).

---

## Naming

| Elemento | Convención | Ejemplo |
|----------|------------|---------|
| Exports | Inglés | `getUser`, `createEvaAuth`, `EvaUser` |
| Archivos | kebab-case | `auth-routes.ts`, `http-client.ts` |
| Funciones | camelCase | `readTokensFromCookies`, `verifyAccessToken` |
| Types | PascalCase | `EvaTokenPayload`, `AuthContextValue` |
| Constantes | UPPER_SNAKE | `HEADERS`, `COOKIES`, `JWT_CONFIG` |

---

## Barrel files

Cada módulo tiene un `index.ts` que re-exporta todo lo público.

**NUNCA** importar directamente archivos internos del módulo desde fuera:

```ts
// Correcto
import { evaAuth } from '@eva/auth-sdk/hono'

// Incorrecto
import { evaAuth } from '@eva/auth-sdk/hono/middleware'
```

---

## Tests

- Un archivo por módulo con sufijo `.mock.test.ts`
- Fixtures compartidas en `tests/helpers/fixtures.ts`
- Runner: Vitest
- Mocks: `vi.mock()`

Estructura:

```
tests/
├── client.mock.test.ts
├── cookies.mock.test.ts
├── hono-auth-routes.mock.test.ts
├── hono-middleware.mock.test.ts
├── jwks.mock.test.ts
├── jwt.mock.test.ts
└── helpers/
    └── fixtures.ts
```

---

## Dependencies

| Dependencia | Uso |
|-------------|-----|
| `jose` | JWT verification, JWKS |
| `bowser` | User-Agent parsing |

### Peer dependencies (opcionales)

| Peer | Versión | Requerida para |
|------|---------|----------------|
| `hono` | >=4 | `@eva/auth-sdk/hono` |
| `react` | >=18 | `@eva/auth-sdk/react` |

**Cero dependencias de Node.js** — funciona en Edge runtime.

---

## Build

- **Tool**: tsup
- **Output**: ESM + CJS con declarations (`.d.ts`)
- **Target**: ES2022
- **Entry points**: 4 (`index`, `hono`, `react`, `generic`)
- **External**: hono, react, react-dom
- **Build-time config**: `EVA_BUILD_ENV` controla constantes horneadas vía `tsup define` (URL del Auth Service, entorno)

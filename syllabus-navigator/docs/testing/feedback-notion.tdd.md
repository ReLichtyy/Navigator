# Feedback global + Notion — evidencia TDD

## Recorrido

Como estudiante autenticado, quiero enviar feedback desde cualquier área, viendo la identidad de
mi sesión y conservando el envío aunque Notion todavía no esté configurado o tenga una
interrupción.

## Punto de partida RED

- Rama: `codex/feedback-notion`.
- Commit RED: `6d69f42b test(feedback): add RED feature contract`.
- Comando: `npm test -- product-feedback`.
- Resultado: 5 suites fallaron por los módulos, endpoint, launcher, modal y traducciones todavía
  inexistentes. Los fallos correspondían al contrato nuevo, no a regresiones previas.

## Ciclos dirigidos

| Garantía                                          | Prueba                                   |      RED |     GREEN |
| ------------------------------------------------- | ---------------------------------------- | -------: | --------: |
| Body estricto, categorías, longitud y visibilidad | `product-feedback-domain.test.ts`        | incluido |       5/5 |
| Configuración diferida y mapper exacto de Notion  | `product-feedback-notion.test.ts`        | incluido |       2/2 |
| Persistencia local-first e idempotencia           | `product-feedback.service.test.ts`       | incluido | pendiente |
| Auth, rate limit y estados 201/202                | `product-feedback.route.test.ts`         | incluido | pendiente |
| Montaje global y primitives compartidos           | `product-feedback-ui-compliance.test.ts` | incluido | pendiente |

GREEN parcial verificado:

```text
npm test -- product-feedback-domain product-feedback-notion
Test Files  2 passed (2)
Tests       7 passed (7)
```

## Ciclo adicional — resolución desde Database ID

Garantía: el enlace de una database de Notion puede usarse sin copiar manualmente el data source
ID. Si contiene una sola fuente, se selecciona automáticamente; si contiene varias, el nombre
configurado debe desambiguarla y, sin selector, el worker queda diferido de forma segura.

RED:

```text
npm.cmd test -- product-feedback-notion.test.ts product-feedback-notion-sync.test.ts
Test Files  2 failed (2)
Tests       4 failed | 6 passed (10)
```

GREEN:

```text
npm.cmd test -- product-feedback-notion.test.ts product-feedback-notion-sync.test.ts
Test Files  2 passed (2)
Tests       10 passed (10)
```

Verificación de regresión de este ciclo:

```text
npm.cmd test -- product-feedback
Test Files  10 passed (10)
Tests       52 passed (52)

npx.cmd tsc --noEmit
PASS

npm.cmd run lint
PASS — sin warnings ni errores ESLint

npm.cmd run build
PASS — build de producción completado
```

No existe un provider de coverage instalado (`@vitest/coverage-v8` o
`@vitest/coverage-istanbul`), por lo que este ciclo no inventa un porcentaje de cobertura. La
garantía queda respaldada por tests unitarios/de integración focales y la suite completa del
feature.

## Verificación final pendiente

Antes de cerrar Task 5A se registrarán aquí la suite focal completa, la suite global, lint,
typecheck/build y QA visual. Las variables reales, la migración y el smoke test de Notion
pertenecen a Task 0B/5B y no forman parte de esta evidencia offline.

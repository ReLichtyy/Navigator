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

## Verificación final pendiente

Antes de cerrar Task 5A se registrarán aquí la suite focal completa, la suite global, lint,
typecheck/build y QA visual. Las variables reales, la migración y el smoke test de Notion
pertenecen a Task 0B/5B y no forman parte de esta evidencia offline.

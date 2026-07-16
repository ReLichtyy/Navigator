# Sugerencias del Asistente requieren confirmación — evidencia TDD

## Recorrido

Como estudiante, quiero que una sugerencia rellene el composer sin enviarse, para poder editarla o descartarla antes de continuar.

## RED → GREEN

| Garantía | Prueba | Tipo | Resultado |
|---|---|---|---|
| La sugerencia rotatoria se dirige al borrador controlado | `tests/chat-suggestions.test.ts` | Contrato de integración UI | PASS |
| Sugerir y regenerar usan callbacks distintos | `tests/chat-suggestions.test.ts` | Contrato de integración UI | PASS |
| Las herramientas rápidas rellenan el composer y no llaman a `onSend` | `tests/chat-suggestions.test.ts` | Contrato de componente | PASS |

- RED: `npm test -- --run tests/chat-suggestions.test.ts` → 3/3 fallos por envío directo y ausencia de borrador controlado.
- GREEN focal: el mismo comando → 3/3 pruebas.
- GREEN global: `npx tsc --noEmit`, `npm run lint`, `npm test` → sin errores; 403/403 pruebas.

## Cobertura y límites

El repositorio no tiene React Testing Library ni un provider de coverage configurados. La prueba sigue el patrón existente de contratos estáticos de UI; no simula el clic en un DOM real. La verificación cubre el cableado que evita el envío automático, pero una prueba E2E de navegador sería la mejora siguiente.

No se crearon commits RED/GREEN porque el árbol contiene cambios locales previos solapados.

# Notas rápidas: título y color persistidos — evidencia TDD

## Fuente y recorrido

Fuente: ítem 1 de `PENDIENTES.md` (2026-07-15).

Como estudiante, quiero que el título y color de una nota rápida se guarden, para que su presentación no cambie al recargar o reordenar notas.

## RED → GREEN

| Garantía | Prueba | Tipo | Resultado |
|---|---|---|---|
| `Título: contenido` y `Título — contenido` se separan antes de guardar | `tests/quick-note.test.ts` | Unidad | PASS |
| Una nota sin separador conserva el cuerpo y no inventa título | `tests/quick-note.test.ts` | Unidad | PASS |
| POST acepta y entrega título/color al repositorio; rechaza colores inválidos | `tests/notes.route.test.ts` | Integración de ruta | PASS |
| PATCH permite actualizar metadata sin exigir `body` | `tests/notes.route.test.ts` | Integración de ruta | PASS |
| El repositorio enlaza título/color y mantiene el scope por usuario | `tests/date-notes.repo.test.ts` | Unidad de repositorio | PASS |

- RED: `npm test -- --run tests/quick-note.test.ts tests/notes.route.test.ts tests/date-notes.repo.test.ts` → 5 fallos intencionales y un módulo aún inexistente.
- GREEN focal: el mismo comando → 27/27 pruebas.
- GREEN global: `npx tsc --noEmit`, `npm run lint` y `npm test` → sin errores; 400/400 pruebas.
- Migración: `npm run db:migrate` → 107 sentencias OK, 0 errores.

## Cobertura y límites

El proyecto no define un script de coverage ni tiene instalado un provider de coverage para Vitest; no se inventa un porcentaje. La suite focal cubre parser, validación, rutas y bindings SQL. No se añadió E2E de navegador para el composer.

No se crearon commits RED/GREEN porque el árbol ya contenía cambios del usuario que se solapan con las rutas, el repositorio, el adapter y el componente modificados.

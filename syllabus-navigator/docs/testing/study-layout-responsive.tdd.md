# Área de Estudio: layout responsivo - evidencia TDD

## Recorrido

Como estudiante con una pantalla amplia, quiero que la configuración de estudio use mejor el espacio disponible sin perder legibilidad en móvil.

## RED y GREEN

| Garantía | Prueba | Tipo | Resultado |
|---|---|---|---|
| El menú aprovecha hasta 1480 px sin quedar ilimitado | `tests/study-layout.test.ts` | Contrato de layout | PASS |
| Material conserva una columna de 300-360 px y el panel derecho crece | `tests/study-layout.test.ts` | Contrato responsivo | PASS |
| El selector de material limita su altura y permite scroll en escritorio | `tests/study-layout.test.ts` | Contrato responsivo | PASS |
| Los modos usan 1, 2 o 3 columnas según el viewport | `tests/study-layout.test.ts` | Contrato responsivo | PASS |

- RED: `npm test -- --run tests/study-layout.test.ts` produjo 3/3 fallos por el layout anterior.
- GREEN focal: `npm test -- --run tests/study-layout.test.ts tests/ui-compliance.test.ts` produjo 39/39 pruebas.
- GREEN global: `npx tsc --noEmit`, `npm run lint` y `npm test` finalizaron sin errores; 406/406 pruebas.

## Límite conocido

La ruta local respondió, pero el navegador aislado no tenía una sesión autenticada y redirigió a `/sign-in`. Por eso no se afirma una inspección visual final del estado con datos reales. La geometría se contrastó con la captura aportada y con contratos de clases responsivas.

No se crearon commits RED/GREEN porque el árbol contiene cambios locales previos solapados.

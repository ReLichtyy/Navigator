# Recuperación de generación de mapas — evidencia TDD

## Fuente

La corrección parte del diagnóstico solicitado por el usuario el 1 de agosto de 2026. No se usó un archivo de plan externo.

## Recorridos de usuario

- Como estudiante, quiero reintentar un mapa sin mantener abierta una petición LLM larga, para que Vercel no deje el documento bloqueado en `processing`.
- Como estudiante, quiero que una descripción demasiado extensa se normalice, para que un solo nodo no invalide todo el mapa.
- Como estudiante, quiero recuperar un trabajo realmente abandonado, sin duplicar otro que todavía está activo.
- Como estudiante, quiero que un estado huérfano aparezca como recuperable, en vez de mostrar un spinner infinito.

## RED → GREEN

| Garantía | Prueba | RED | GREEN |
|---|---|---|---|
| Las descripciones generadas de más de 140 caracteres se truncan antes de validar | `tests/graph-gen.test.ts` | `ZodError: too_big` | Pasa y conserva exactamente 140 caracteres |
| Un trabajo que agotó intentos no vuelve a ser reclamado automáticamente | `tests/job.repo.test.ts` | La consulta no limitaba `attempts` | Pasa con `attempts < max_attempts` |
| Un reintento recupera trabajos abandonados, pero no reinicia una última tentativa activa | `tests/job.repo.test.ts` | El trabajo abandonado no se reactivaba; después se detectó el caso activo | Ambos casos pasan |
| La regeneración documental responde `202` y no ejecuta el generador en la petición | `tests/graph-reprocess.route.test.ts`, `tests/graph.route.test.ts` | Respondía `200` y llamaba al drenaje inline | Responde `202` con `ArtifactRunAPI` |
| Los mapas documentales huérfanos dejan de aparecer eternamente en procesamiento | `tests/graph.service.test.ts` | Estado visible `processing` | Estado visible `failed` con mensaje recuperable |
| Los mapas de curso huérfanos se recuperan sin ocultar el último mapa listo | `tests/course-graph.route.test.ts` | Estado visible `processing` | `failed` sin datos o `stale` con datos previos |

Comando RED inicial:

```text
npm.cmd test -- tests/graph-gen.test.ts tests/job.repo.test.ts tests/course-graph.route.test.ts tests/graph-reprocess.route.test.ts tests/graph.service.test.ts
Resultado: 7 fallos esperados, 30 pruebas aprobadas.
```

Comandos GREEN finales:

```text
npm.cmd test
Resultado: 72 archivos, 507 pruebas aprobadas.

npx.cmd tsc --noEmit
Resultado: sin errores.

npm.cmd run build
Resultado: compilación de producción correcta; 8 pasos y 2 workflows detectados.
```

## Cobertura y límites conocidos

El proyecto no tiene instalado un proveedor de cobertura de Vitest (`@vitest/coverage-v8` o `@vitest/coverage-istanbul`), por lo que no se inventa un porcentaje. La verificación incluye pruebas unitarias, de repositorio, de servicio y de ruta, además de la suite completa y la compilación. La reproducción visual autenticada en producción queda fuera de esta ejecución local.

## Evidencia de merge

No se crearon commits de checkpoint: se intentó abrir una rama `codex/fix-map-generation`, pero la autorización fue rechazada. Los cambios permanecen sin commit para revisión del usuario.

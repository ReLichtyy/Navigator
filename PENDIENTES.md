
### Plan backend restante (siguiente iteración)

1. **Notas sin fecha (inbox)**: permitir `note_date NULL` para notas rápidas no ancladas a un día (hoy se anclan a "hoy"). Ajustar `listByDate`/`listDates` (excluir NULL) y el marcador del calendario.
2. **Cache corta para `/api/topics`** (`lib/cache`, key por user, invalidar en `graph-gen`/reprocess/delete doc) — hoy consulta directa; barato pero repetitivo al navegar.
3. **Archivo de temas → deep-link con topic**: `/estudio?course=X&topic=Y` para que el chip abra el modo estudio ya filtrado por tema (el chip ya enlaza al curso).
4. **Contador de docs en "Próximos 5 días" vacío**: el hint de `term_start` ya se muestra; falta acción inline (abrir el editor de term_start del curso desde la derecha, hoy vive en la carpeta izquierda).

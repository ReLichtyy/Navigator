# Pendientes — planes de implementación

> Sustituye a `NEXT_STEPS.md` (borrado 2026-07-02; todo su log histórico está en git history).
> Solo contiene lo que FALTA. Referencia estable de estructura: `CLAUDE.md`.
> Descartados a propósito (selección del usuario 2026-07-02): SQL crudo de
> user/preferences|feedback|cron/cleanup → repos; B4 pre-calentar quiz bank; cron a */5.

---

## Ops / infra (checklist corto)

- [ ] **Railway — EXPORTAR DATOS antes de apagar.** Confirmado (2026-07-02): el FastAPI viejo
      sigue desplegado en Railway CON datos que importan. El código fuente ya no está en el
      repo (borrado 2026-06-23; recuperable de git history). Acción: dump de su DB/Chroma
      (o al menos los uploads/syllabi que no existan ya en Neon) → luego apagar el servicio
      para dejar de pagar. Sin esto NO apagar nada.
- [ ] **Vercel**: verificar que `BLOB_READ_WRITE_TOKEN` está seteado (sin él los PDFs de
      cuenta no se persisten; degrada con warning en logs). CLI de Vercel no instalada en
      esta máquina — revisar en dashboard (Settings → Environment Variables).

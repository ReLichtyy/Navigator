import { describe, expect, it } from "vitest"
import {
  buildNotionFeedbackProperties,
  resolveNotionFeedbackConfig,
} from "@/lib/server/integrations/notion-feedback"

const feedback = {
  id: "a2d626b1-f48c-4cff-87d3-ec6294f21cf3",
  personName: "Ada Lovelace",
  category: "Sugerencia" as const,
  description: "Añadir filtros por curso.",
  createdAt: "2026-07-21T12:30:00.000Z",
}

describe("Notion feedback preconfiguration", () => {
  it("stays unconfigured until both server-only variables exist", () => {
    expect(resolveNotionFeedbackConfig({})).toBeNull()
    expect(resolveNotionFeedbackConfig({ NOTION_ACCESS_TOKEN: "secret" })).toBeNull()
    expect(
      resolveNotionFeedbackConfig({
        NOTION_ACCESS_TOKEN: "secret",
        NOTION_FEEDBACK_DATA_SOURCE_ID: "source-id",
      }),
    ).toEqual({ accessToken: "secret", dataSourceId: "source-id" })
  })

  it("maps exactly the five requested Notion properties", () => {
    const properties = buildNotionFeedbackProperties(feedback)
    expect(Object.keys(properties)).toEqual([
      "ID",
      "Nombre de Persona",
      "Fecha",
      "Categoria",
      "Descripcion",
    ])
    expect(properties.ID).toEqual({
      title: [{ type: "text", text: { content: feedback.id } }],
    })
    expect(properties["Nombre de Persona"]).toEqual({
      rich_text: [{ type: "text", text: { content: feedback.personName } }],
    })
    expect(properties.Fecha).toEqual({ date: { start: feedback.createdAt } })
    expect(properties.Categoria).toEqual({ select: { name: feedback.category } })
    expect(properties.Descripcion).toEqual({
      rich_text: [{ type: "text", text: { content: feedback.description } }],
    })
  })
})

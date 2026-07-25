import { beforeEach, describe, expect, it, vi } from "vitest"

const sdk = vi.hoisted(() => ({
  retrieve: vi.fn(),
  query: vi.fn(),
  create: vi.fn(),
  Client: vi.fn(),
}))

vi.mock("@notionhq/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@notionhq/client")>()
  sdk.Client.mockImplementation(function MockNotionClient() {
    return {
      dataSources: { retrieve: sdk.retrieve, query: sdk.query },
      pages: { create: sdk.create },
    }
  })
  return { ...actual, Client: sdk.Client }
})

import {
  checkNotionFeedbackReadiness,
  syncProductFeedbackToNotion,
} from "@/lib/server/integrations/notion-feedback"

const feedback = {
  id: "a2d626b1-f48c-4cff-87d3-ec6294f21cf3",
  personName: "Ada Lovelace",
  category: "Sugerencia" as const,
  description: "Añadir filtros por curso.",
  createdAt: "2026-07-21T12:30:00.000Z",
}
const env = {
  NOTION_ACCESS_TOKEN: "test-token",
  NOTION_FEEDBACK_DATA_SOURCE_ID: "feedback-source",
}

beforeEach(() => {
  sdk.retrieve.mockReset()
  sdk.query.mockReset()
  sdk.create.mockReset()
})

describe("Notion product feedback reconciliation", () => {
  it("does not construct a client or call the network without both variables", async () => {
    const clientsBefore = sdk.Client.mock.calls.length

    await expect(syncProductFeedbackToNotion(feedback, {})).resolves.toEqual({
      status: "pending",
      reason: "not_configured",
    })
    expect(sdk.Client.mock.calls).toHaveLength(clientsBefore)
    expect(sdk.query).not.toHaveBeenCalled()
    expect(sdk.create).not.toHaveBeenCalled()
  })

  it("reuses a page found by the stable app ID instead of creating a duplicate", async () => {
    sdk.query.mockResolvedValue({ results: [{ object: "page", id: "existing-page" }] })

    await expect(syncProductFeedbackToNotion(feedback, env)).resolves.toEqual({
      status: "synced",
      pageId: "existing-page",
    })
    expect(sdk.query).toHaveBeenCalledWith({
      data_source_id: "feedback-source",
      filter: { property: "ID", title: { equals: feedback.id } },
      page_size: 1,
      result_type: "page",
    })
    expect(sdk.create).not.toHaveBeenCalled()
  })

  it("creates one page under the configured data source when the ID is absent", async () => {
    sdk.query.mockResolvedValue({ results: [] })
    sdk.create.mockResolvedValue({ id: "created-page" })

    await expect(syncProductFeedbackToNotion(feedback, env)).resolves.toEqual({
      status: "synced",
      pageId: "created-page",
    })
    expect(sdk.create).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: { data_source_id: "feedback-source" },
        properties: expect.objectContaining({
          ID: expect.any(Object),
          "Nombre de Persona": expect.any(Object),
          Fecha: expect.any(Object),
          Categoria: expect.any(Object),
          Descripcion: expect.any(Object),
        }),
      }),
    )
  })

  it("validates the exact data-source schema before a worker consumes jobs", async () => {
    sdk.retrieve.mockResolvedValue({
      properties: {
        ID: { type: "title" },
        "Nombre de Persona": { type: "rich_text" },
        Fecha: { type: "date" },
        Categoria: {
          type: "select",
          select: {
            options: ["Error", "Sugerencia", "Usabilidad", "Contenido", "Otro"].map((name) => ({
              name,
            })),
          },
        },
        Descripcion: { type: "rich_text" },
      },
    })

    await expect(checkNotionFeedbackReadiness(env)).resolves.toEqual({ ready: true })
    expect(sdk.retrieve).toHaveBeenCalledWith({ data_source_id: "feedback-source" })
    expect(sdk.Client).toHaveBeenCalledWith(
      expect.objectContaining({
        timeoutMs: 4_000,
        retry: false,
        logger: expect.any(Function),
      }),
    )
  })

  it("defers the queue when a required Notion property has the wrong type", async () => {
    sdk.retrieve.mockResolvedValue({
      properties: {
        ID: { type: "rich_text" },
        "Nombre de Persona": { type: "rich_text" },
        Fecha: { type: "date" },
        Categoria: { type: "select", select: { options: [] } },
        Descripcion: { type: "rich_text" },
      },
    })

    await expect(checkNotionFeedbackReadiness(env)).resolves.toEqual({
      ready: false,
      reason: "schema_mismatch",
    })
  })
})

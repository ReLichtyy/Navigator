import {
  APIErrorCode,
  Client,
  ClientErrorCode,
  isNotionClientError,
  type CreatePageParameters,
} from "@notionhq/client"
import {
  PRODUCT_FEEDBACK_CATEGORIES,
  type ProductFeedbackCategory,
} from "@/lib/ui/product-feedback"

export const NOTION_API_VERSION = "2026-03-11"

export interface NotionFeedbackConfig {
  accessToken: string
  dataSourceId: string
}

type NotionFeedbackEnvironment = {
  readonly [key: string]: string | undefined
  NOTION_ACCESS_TOKEN?: string
  NOTION_FEEDBACK_DATA_SOURCE_ID?: string
}

export interface NotionFeedbackPayload {
  id: string
  personName: string
  category: ProductFeedbackCategory
  description: string
  createdAt: string
}

export type NotionFeedbackProperties = NonNullable<CreatePageParameters["properties"]>

export type NotionFeedbackSyncResult =
  | { status: "synced"; pageId: string }
  | { status: "pending"; reason: string; retryable?: boolean }

export type NotionFeedbackReadiness = { ready: true } | { ready: false; reason: string }

export function resolveNotionFeedbackConfig(
  env: NotionFeedbackEnvironment = process.env,
): NotionFeedbackConfig | null {
  const accessToken = env.NOTION_ACCESS_TOKEN?.trim()
  const dataSourceId = env.NOTION_FEEDBACK_DATA_SOURCE_ID?.trim()
  if (!accessToken || !dataSourceId) return null
  return { accessToken, dataSourceId }
}

export function isNotionFeedbackConfigured(env: NotionFeedbackEnvironment = process.env): boolean {
  return resolveNotionFeedbackConfig(env) !== null
}

export function buildNotionFeedbackProperties(
  feedback: NotionFeedbackPayload,
): NotionFeedbackProperties {
  return {
    ID: {
      title: [{ type: "text", text: { content: feedback.id } }],
    },
    "Nombre de Persona": {
      rich_text: [{ type: "text", text: { content: feedback.personName } }],
    },
    Fecha: { date: { start: feedback.createdAt } },
    Categoria: { select: { name: feedback.category } },
    Descripcion: {
      rich_text: [{ type: "text", text: { content: feedback.description } }],
    },
  }
}

let cachedClient: { key: string; client: Client } | null = null

function getNotionClient(config: NotionFeedbackConfig): Client {
  const key = `${config.dataSourceId}:${config.accessToken}`
  if (cachedClient?.key === key) return cachedClient.client

  const client = new Client({
    auth: config.accessToken,
    notionVersion: NOTION_API_VERSION,
    timeoutMs: 4_000,
    retry: false,
    logger: () => undefined,
  })
  cachedClient = { key, client }
  return client
}

const RETRYABLE_CODES = new Set<string>([
  APIErrorCode.RateLimited,
  APIErrorCode.InternalServerError,
  APIErrorCode.ServiceOverload,
  APIErrorCode.ServiceUnavailable,
  APIErrorCode.GatewayTimeout,
  APIErrorCode.ConflictError,
  ClientErrorCode.RequestTimeout,
  ClientErrorCode.ResponseError,
])

function classifyNotionError(error: unknown): { reason: string; retryable: boolean } {
  if (!isNotionClientError(error)) return { reason: "network_error", retryable: true }
  return { reason: error.code, retryable: RETRYABLE_CODES.has(error.code) }
}

const REQUIRED_PROPERTY_TYPES = {
  ID: "title",
  "Nombre de Persona": "rich_text",
  Fecha: "date",
  Categoria: "select",
  Descripcion: "rich_text",
} as const

/**
 * Read-only preflight used before a queue worker claims a job. Configuration,
 * access, or schema problems remain deferred and therefore consume no attempts.
 */
export async function checkNotionFeedbackReadiness(
  env: NotionFeedbackEnvironment = process.env,
): Promise<NotionFeedbackReadiness> {
  const config = resolveNotionFeedbackConfig(env)
  if (!config) return { ready: false, reason: "not_configured" }

  try {
    const dataSource = await getNotionClient(config).dataSources.retrieve({
      data_source_id: config.dataSourceId,
    })
    for (const [name, type] of Object.entries(REQUIRED_PROPERTY_TYPES)) {
      if (dataSource.properties[name]?.type !== type) {
        return { ready: false, reason: "schema_mismatch" }
      }
    }

    const category = dataSource.properties.Categoria
    if (category.type !== "select") return { ready: false, reason: "schema_mismatch" }
    const options = new Set(category.select.options.map((option) => option.name))
    if (PRODUCT_FEEDBACK_CATEGORIES.some((name) => !options.has(name))) {
      return { ready: false, reason: "schema_mismatch" }
    }

    return { ready: true }
  } catch (error) {
    return { ready: false, reason: classifyNotionError(error).reason }
  }
}

/**
 * Reconciles by the app UUID before creating a page. Missing configuration is a
 * normal pre-activation state: the local row remains pending without a network call.
 */
export async function syncProductFeedbackToNotion(
  feedback: NotionFeedbackPayload,
  env: NotionFeedbackEnvironment = process.env,
): Promise<NotionFeedbackSyncResult> {
  const config = resolveNotionFeedbackConfig(env)
  if (!config) return { status: "pending", reason: "not_configured" }

  const notion = getNotionClient(config)
  try {
    const existing = await notion.dataSources.query({
      data_source_id: config.dataSourceId,
      filter: { property: "ID", title: { equals: feedback.id } },
      page_size: 1,
      result_type: "page",
    })
    const existingPage = existing.results.find((result) => result.object === "page")
    if (existingPage) return { status: "synced", pageId: existingPage.id }

    const page = await notion.pages.create({
      parent: { data_source_id: config.dataSourceId },
      properties: buildNotionFeedbackProperties(feedback),
    })
    return { status: "synced", pageId: page.id }
  } catch (error) {
    const classified = classifyNotionError(error)
    return { status: "pending", ...classified }
  }
}

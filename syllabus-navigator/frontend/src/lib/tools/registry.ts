/**
 * tools/registry.ts — Central registry for the Actions & Tools layer.
 *
 * Tools register here; orchestration looks them up by name. Keeping a single
 * registry lets us expose the full set to a tool-calling loop and enforce
 * one source of truth for what the assistant is allowed to do.
 */

import type { Tool } from "./types"

// Tools declare narrow arg/data generics; the registry stores them
// type-erased so heterogeneous tools share one map. `any` (not `unknown`) is
// required here: execute() is contravariant in its args, so a narrowly-typed
// tool isn't assignable to a `Record<string,unknown>`-arg slot.
type AnyTool = Tool<any, any>

const registry = new Map<string, AnyTool>()

/** Register a tool. Throws on duplicate names to catch wiring mistakes early. */
export function registerTool(tool: AnyTool): void {
  if (registry.has(tool.name)) {
    throw new Error(`tools: duplicate tool name "${tool.name}"`)
  }
  registry.set(tool.name, tool)
}

/** Look up a tool by name. */
export function getTool(name: string): AnyTool | undefined {
  return registry.get(name)
}

/** All registered tools (insertion order). */
export function listTools(): AnyTool[] {
  return [...registry.values()]
}

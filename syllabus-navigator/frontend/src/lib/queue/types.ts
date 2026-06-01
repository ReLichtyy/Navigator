/**
 * queue/types.ts — Async job queue type definitions (P1 stub).
 */

export type JobType = "pdf:process" | "graph:generate" | "usage:aggregate"
export type JobStatus = "pending" | "running" | "completed" | "failed"

export interface Job {
  id: string
  type: JobType
  payload: Record<string, unknown>
  status: JobStatus
  priority: number
  result?: Record<string, unknown>
  error?: string
  createdAt: Date
  startedAt?: Date
  completedAt?: Date
}

export interface QueueAdapter {
  enqueue(type: JobType, payload: Record<string, unknown>, priority?: number): Promise<string>
  dequeue(): Promise<Job | null>
  complete(jobId: string, result?: Record<string, unknown>): Promise<void>
  fail(jobId: string, error: string): Promise<void>
  getJob(jobId: string): Promise<Job | null>
}

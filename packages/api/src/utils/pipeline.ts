import { SearchSessionModel } from '../db/models.js'
import { SSEManager } from './SSEManager.js'
import { PipelineEvent } from '@job-search/shared'

export async function emitPipelineEvent(
  searchId: string,
  step: string,
  type: PipelineEvent['type'],
  label: string,
  detail?: string,
  metadata?: Record<string, unknown>,
  sseManager?: SSEManager
): Promise<void> {
  const event: PipelineEvent = {
    timestamp: new Date(),
    step,
    type,
    label,
    detail,
    metadata,
  }

  // Persist to database
  try {
    await SearchSessionModel.findByIdAndUpdate(searchId, {
      $push: { pipelineEvents: event }
    })
  } catch (err) {
    console.error(`Failed to persist pipeline event for ${searchId}:`, err)
  }

  // Broadcast via SSE
  if (sseManager) {
    sseManager.broadcast(searchId, {
      type: 'pipeline_event',
      payload: event as unknown as Record<string, unknown>,
    })
  }
}

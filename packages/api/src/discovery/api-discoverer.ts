import { callClaude } from '../claude/client.js'
import type { DiscoveredApiConfig } from '@job-search/shared'

interface CapturedRequest {
  url: string
  method: string
  responseBody: string
  responseStatus: number
}

export async function discoverJobsApi(
  userId: string,
  companyName: string,
  careerUrl: string,
  networkCapture: CapturedRequest[]
): Promise<DiscoveredApiConfig | null> {
  const candidates = networkCapture.slice(0, 5)
  const candidateText = candidates
    .map(
      (r, i) => `
--- Request ${i + 1} ---
URL: ${r.url}
Method: ${r.method}
Response preview: ${r.responseBody.slice(0, 1500)}
`
    )
    .join('\n')

  const prompt = `Company: ${companyName}
Career page: ${careerUrl}

This career page is a JavaScript SPA. Here are the JSON API calls the browser made:
${candidateText}

Which endpoint returns the job listings? Respond with ONLY valid JSON, no other text:
{
  "endpoint": "base URL without query parameters",
  "method": "GET",
  "paramTemplate": { "searchText": "{keywords}", "limit": 50 },
  "fieldMapping": { "title": "dot.path", "url": "dot.path", "location": "dot.path", "description": "dot.path" },
  "platform": "workday|greenhouse|lever|custom",
  "confidence": 0.0
}`

  let raw: string
  try {
    raw = await callClaude(userId, prompt)
  } catch (err) {
    console.warn('discoverJobsApi: callClaude failed:', err)
    return null
  }

  let config: any
  try {
    const cleaned = raw
      .replace(/^```json\s*/m, '')
      .replace(/^```\s*/m, '')
      .replace(/```\s*$/m, '')
    config = JSON.parse(cleaned)
  } catch {
    console.warn('discoverJobsApi: Claude returned invalid JSON:', raw.slice(0, 200))
    return null
  }

  if (!config.confidence || config.confidence < 0.6) {
    console.warn('discoverJobsApi: low confidence', config.confidence)
    return null
  }

  return {
    endpoint: config.endpoint,
    method: config.method || 'GET',
    paramTemplate: config.paramTemplate || {},
    fieldMapping: config.fieldMapping,
    platform: config.platform,
    discoveredAt: new Date(),
  }
}

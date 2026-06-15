import type { DiscoveredApiConfig } from '@job-search/shared'

export interface FetchedJob {
  title: string
  company: string
  location: string
  url: string
  description: string
  sourceUrl: string
}

export function get(obj: any, path: string): string {
  if (!path) return ''
  const value = path.split('.').reduce((o: any, k: string) => o?.[k], obj)
  return value != null ? String(value) : ''
}

const ARRAY_KEYS = ['jobs', 'postings', 'positions', 'results', 'data', 'items', 'requisitions']

export function extractArray(data: any): any[] {
  if (Array.isArray(data)) return data
  for (const key of ARRAY_KEYS) {
    if (data[key] && Array.isArray(data[key])) return data[key]
  }
  for (const val of Object.values(data)) {
    if (Array.isArray(val) && (val as any[]).length > 0) return val as any[]
  }
  return []
}

export function buildParams(template: Record<string, any>, keywords: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(template)) {
    result[key] = String(value).replace('{keywords}', keywords)
  }
  return result
}

export async function fetchFromDiscoveredApi(
  config: DiscoveredApiConfig,
  keywords: string,
  companyName: string,
  careerUrl: string
): Promise<FetchedJob[]> {
  const params = buildParams(config.paramTemplate, keywords)
  const queryString = new URLSearchParams(params).toString()
  const fullUrl = queryString ? `${config.endpoint}?${queryString}` : config.endpoint

  const res = await fetch(fullUrl, { method: config.method })
  if (!res.ok) {
    throw new Error(`DirectFetcher: HTTP ${res.status} from ${config.endpoint}`)
  }
  const data = await res.json()
  const items = extractArray(data)

  return items
    .map((item: any) => ({
      title: get(item, config.fieldMapping.title),
      company: companyName,
      location: get(item, config.fieldMapping.location) || 'Not specified',
      url: get(item, config.fieldMapping.url) || careerUrl,
      description: get(item, config.fieldMapping.description) || `Job opening at ${companyName}`,
      sourceUrl: careerUrl,
    }))
    .filter((j: FetchedJob) => j.title.length >= 10)
}

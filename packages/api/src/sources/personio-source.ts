// packages/api/src/sources/personio-source.ts
import axios from 'axios'
import * as cheerio from 'cheerio'
import type { Cheerio } from 'cheerio'
import { JobQuery, JobSource, SourceJob, SourceResult } from './types.js'

// Personio XML board feed: https://<slug>.jobs.personio.de/xml?language=de
// Source-slug is passed via PersonioSource constructor or env PERSONIO_SLUG.
export class PersonioSource implements JobSource {
  name = 'personio'
  tier = 3 as const

  private slug: string
  private boardUrl: string

  constructor(slug?: string) {
    this.slug = slug ?? process.env.PERSONIO_SLUG ?? 'company'
    this.boardUrl = `https://${this.slug}.jobs.personio.de/xml?language=de`
  }

  async search(query: JobQuery): Promise<SourceResult> {
    if (!process.env.ENABLE_TIER3) {
      return { source: this.name, jobs: [], errors: [] }
    }

    const errors: SourceResult['errors'] = []
    const jobs: SourceJob[] = []

    try {
      const response = await axios.get(this.boardUrl, {
        timeout: 15000,
      })

      const xml = typeof response.data === 'string' ? response.data : String(response.data)
      const $ = cheerio.load(xml, { xml: true })
      const positions = $('position')

      positions.each((_, el) => {
        try {
          const job = this.toSourceJob($, el)
          if (job) jobs.push(job)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          errors.push({ message: `personio position: ${message}` })
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push({ message: `personio fetch: ${message}` })
    }

    return { source: this.name, jobs, errors }
  }

  private toSourceJob($: any, el: any): SourceJob | null {
    const id = $(el).find('id').text().trim()
    const name = $(el).find('name').text().trim()
    const subcompany = $(el).find('subcompany').text().trim()
    const office = $(el).children('office').first().text().trim()

    if (!id || !name) return null

    const company = subcompany || 'Unknown'
    const title = name
    const location = office || ''

    // Best-guess posting URL using the board slug and job id.
    const url = `https://${this.slug}.jobs.personio.de/en/posting/${id}`
    const sourceUrl = `https://${this.slug}.jobs.personio.de/`

    const createdAtEl = $(el).find('createdAt').text().trim()
    const publishedAt = createdAtEl ? new Date(createdAtEl).toISOString() : undefined

    const descriptionEl = $(el).find('jobDescription').first()
    const description = descriptionEl.text().trim() || this.describe(title, company, location)

    const additionalOffices = $(el)
      .find('additionalOffices office')
      .map((_i: number, o: any) => $(o).text().trim())
      .get()
    const remote = additionalOffices.some((o: string) => o.toLowerCase().includes('remote')) ? 'full' : 'unknown'

    return {
      title,
      company,
      url,
      location,
      description,
      sourceUrl,
      publishedAt,
      remote,
    }
  }

  private describe(title: string, company: string, location: string): string {
    return `${title} bei ${company} in ${location}.`
  }
}
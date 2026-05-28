import { SearchResult, AnalyzedPage, PageAnalysisOptions } from './interfaces.js'
import { callClaude } from '../claude/client.js'

export class PageAnalyzer {
  async analyzePages(
    results: SearchResult[],
    userQuery: string,
    userId: string = 'system',
    options: PageAnalysisOptions = {}
  ): Promise<AnalyzedPage[]> {
    const maxPages = options.maxPages || 20
    const minConfidence = options.minConfidence || 0.3

    try {
      const pagesToAnalyze = results.slice(0, maxPages)

      const prompt = `Given the user is searching for: "${userQuery}"

And these pages were found:
${pagesToAnalyze.map((r, i) => `${i + 1}. ${r.title}\n   URL: ${r.url}\n   Snippet: ${r.snippet}`).join('\n\n')}

For each URL (1-${pagesToAnalyze.length}), determine:
1. Does it likely contain job postings relevant to the query? (confidence 0-1)
2. How high priority is it? (1-10, higher = more relevant jobs)
3. Brief reason why

Return ONLY valid JSON array, no other text:
[
  {
    "urlIndex": 1,
    "confidence": 0.95,
    "priority": 10,
    "reason": "LinkedIn job board, highly relevant"
  },
  ...
]`

      const response = await callClaude(userId, prompt)
      const analyzed = this.parseAnalysis(response, pagesToAnalyze, minConfidence)

      return analyzed.sort((a, b) => b.priority - a.priority)
    } catch (error) {
      console.error('PageAnalyzer failed:', error instanceof Error ? error.message : error)
      return this.fallbackAnalysis(results, userQuery, minConfidence)
    }
  }

  private parseAnalysis(
    response: string,
    pages: SearchResult[],
    minConfidence: number
  ): AnalyzedPage[] {
    try {
      const jsonMatch = response.match(/\[\s\S]*\]/)
      if (!jsonMatch) {
        throw new Error('No JSON array found in response')
      }

      const analyzed = JSON.parse(jsonMatch[0])

      return analyzed
        .filter((item: any) => item.confidence >= minConfidence)
        .map((item: any) => ({
          url: pages[item.urlIndex - 1]?.url || '',
          confidence: Math.min(1, Math.max(0, item.confidence)),
          reason: item.reason || 'Analyzed by Claude',
          priority: Math.min(10, Math.max(1, item.priority))
        }))
        .filter((item: any) => item.url)
    } catch (error) {
      console.warn('Failed to parse Claude analysis:', error)
      throw error
    }
  }

  private fallbackAnalysis(results: SearchResult[], userQuery: string, minConfidence: number = 0.3): AnalyzedPage[] {
    // Known job boards - highest confidence
    const jobBoards = ['linkedin.com', 'indeed.com', 'glassdoor.com', 'dice.com', 'builtin.com', 'angel.co', 'monster.com', 'ziprecruiter.com']
    const jobKeywords = ['job', 'career', 'hire', 'recruit', 'position', 'vacancy', 'opening']
    const queryTerms = userQuery.toLowerCase().split(' ')

    return results
      .map(result => {
        const urlLower = result.url.toLowerCase()
        const titleLower = result.title.toLowerCase()
        const snippetLower = result.snippet.toLowerCase()

        // Check if it's a known job board
        const isKnownJobBoard = jobBoards.some(board => urlLower.includes(board))

        // Count job keyword matches
        const jobMatches = jobKeywords.filter(
          kw => titleLower.includes(kw) || snippetLower.includes(kw)
        ).length

        // Count query term matches
        const queryMatches = queryTerms.filter(
          term => titleLower.includes(term) || snippetLower.includes(term)
        ).length

        // Calculate confidence
        let confidence = 0
        if (isKnownJobBoard) {
          confidence = 0.85 // Known job boards get high confidence
        } else {
          confidence = Math.min(
            1,
            (jobMatches / jobKeywords.length) * 0.6 + (queryMatches / queryTerms.length) * 0.4
          )
        }

        const priority = Math.max(1, Math.round(confidence * 10))

        return {
          url: result.url,
          confidence: Math.max(0.35, confidence), // Boost minimum to ensure fallback works
          reason: isKnownJobBoard ? 'Known job board' : 'Heuristic fallback analysis',
          priority
        }
      })
      .filter(item => item.confidence >= Math.min(minConfidence, 0.35))
      .sort((a, b) => b.priority - a.priority)
  }
}

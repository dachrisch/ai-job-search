import { callClaude } from '../claude/client.js'

/**
 * Represents a company career page discovered by the utility
 */
export interface Company {
  name: string
  url: string
  location?: string
}

/**
 * Known job aggregator domains that should be filtered out
 */
const JOB_AGGREGATORS = [
  'indeed.com',
  'linkedin.com',
  'glassdoor.com',
  'dice.com',
  'builtin.com',
  'monster.com',
  'careerbuilder.com',
  'ziprecruiter.com',
  'flexjobs.com',
  'weworkremotely.com',
  'remote.co',
  'snagajob.com',
]

/**
 * Checks if a URL belongs to a known job aggregator
 * @param url The URL to check
 * @returns true if the URL is a job aggregator
 */
export function isAggregator(url: string): boolean {
  try {
    const urlObj = new URL(url)
    const domain = urlObj.hostname.toLowerCase()

    // Check if the domain or any parent domain is in our aggregator list
    return JOB_AGGREGATORS.some((aggregator) => domain.includes(aggregator))
  } catch {
    // Invalid URL format
    return false
  }
}

/**
 * Validates that a URL is properly formatted
 * @param urlString The URL string to validate
 * @returns true if the URL is valid
 */
export function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    // Ensure it's http or https protocol
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Validates and extracts company career pages from LLM response
 * Uses Claude to analyze search results and identify legitimate company career pages,
 * filtering out job aggregators and validating URLs
 *
 * @param userId The user ID for Claude API authentication
 * @param query The search query (e.g., "senior software engineer")
 * @param searchResults The search results to analyze
 * @returns Array of validated companies with career pages
 */
export async function validateAndExtractCompanies(
  userId: string,
  query: string,
  searchResults: any[]
): Promise<Company[]> {
  // Build the prompt for Claude
  const searchResultsText =
    searchResults.length > 0
      ? searchResults
          .slice(0, 20)
          .map((result, idx) => `${idx + 1}. ${result.title || 'Unknown'} - ${result.url || 'No URL'}`)
          .join('\n')
      : 'No search results provided'

  const prompt = `Analyze the following search results for the query "${query}" and identify company career pages.
Focus on finding direct company career pages (e.g., careers.company.com, company.com/careers) rather than job aggregators.

Search Results:
${searchResultsText}

Please identify legitimate company career pages from these results and return a JSON object with the following structure:
{
  "companies": [
    {
      "name": "Company Name",
      "url": "https://careers.company.com",
      "location": "City, State (optional)"
    }
  ]
}

Only include companies where:
1. The URL is a direct company career page (not an aggregator like Indeed, LinkedIn, Glassdoor, etc.)
2. The company name is clearly identified
3. You have reasonable confidence it's a legitimate company career page

Return only valid JSON, no additional text.`

  try {
    // Call Claude to identify companies
    const response = await callClaude(userId, prompt)

    // Parse the JSON response
    let parsedResponse: any
    try {
      parsedResponse = JSON.parse(response)
    } catch {
      // If JSON parsing fails, return empty array
      return []
    }

    if (!parsedResponse.companies || !Array.isArray(parsedResponse.companies)) {
      return []
    }

    // Filter and validate companies
    const validatedCompanies: Company[] = []

    for (const company of parsedResponse.companies) {
      // Validate required fields
      if (!company.name || typeof company.name !== 'string' || !company.url || typeof company.url !== 'string') {
        continue
      }

      // Validate URL format
      if (!isValidUrl(company.url)) {
        continue
      }

      // Filter out aggregators
      if (isAggregator(company.url)) {
        continue
      }

      // Build the company object
      const validatedCompany: Company = {
        name: company.name.trim(),
        url: company.url.trim(),
      }

      // Add location if provided
      if (company.location && typeof company.location === 'string') {
        validatedCompany.location = company.location.trim()
      }

      validatedCompanies.push(validatedCompany)
    }

    return validatedCompanies
  } catch (error) {
    // If the Claude call fails, return empty array
    console.error('Error validating companies:', error)
    return []
  }
}

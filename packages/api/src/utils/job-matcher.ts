/**
 * Keyword matching utility for quick filtering of jobs before LLM scoring.
 * Implements a multi-level similarity matching algorithm:
 * 1. Exact match: returns 1.0
 * 2. Substring match: returns 0.8
 * 3. Word-level matching: calculates ratio of matched words
 */

export interface KeywordMatchResult {
  /** Score between 0 and 1, indicating match quality */
  score: number
  /** Human-readable explanation of the score */
  reasoning: string
}

/**
 * Calculates keyword similarity between a job title and a search query.
 *
 * Scoring algorithm:
 * - Exact match: 1.0
 * - Substring match: 0.8
 * - Word-level match: (matched_words / total_query_words) * 0.9, capped at 0.9
 * - With description: (title_score * 0.7) + (description_score * 0.3)
 * - Score is rounded to 2 decimal places
 *
 * @param jobTitle - The title of the job to match
 * @param query - The search query keywords
 * @param description - Optional job description to enhance matching
 * @returns KeywordMatchResult with score (0-1) and reasoning
 */
export function calculateKeywordMatch(
  jobTitle: string,
  query: string,
  description?: string
): KeywordMatchResult {
  // Normalize inputs
  const normalizedTitle = jobTitle.toLowerCase().trim()
  const normalizedQuery = query.toLowerCase().trim()
  const normalizedDescription = description?.toLowerCase().trim()

  // Calculate title score
  const titleScore = calculateSimilarity(normalizedTitle, normalizedQuery)

  // If description provided, weight and combine scores
  if (normalizedDescription) {
    const descriptionScore = calculateSimilarity(normalizedDescription, normalizedQuery)
    const combinedScore = titleScore * 0.7 + descriptionScore * 0.3
    const roundedScore = Math.round(combinedScore * 100) / 100

    const reasoning = `Title match: ${Math.round(titleScore * 100)}%, Description match: ${Math.round(descriptionScore * 100)}%, Combined: ${Math.round(roundedScore * 100)}%`

    return {
      score: roundedScore,
      reasoning
    }
  }

  // Title only
  const roundedScore = Math.round(titleScore * 100) / 100
  const reasoning = `Title match: ${Math.round(titleScore * 100)}%`

  return {
    score: roundedScore,
    reasoning
  }
}

/**
 * Calculates similarity score between text and query using multi-level matching.
 *
 * @param text - The text to search in (normalized and lowercase)
 * @param query - The query to search for (normalized and lowercase)
 * @returns Score between 0 and 1
 */
function calculateSimilarity(text: string, query: string): number {
  // Handle empty strings
  if (!query) return 0
  if (!text) return 0

  // Exact match
  if (text === query) {
    return 1.0
  }

  // Substring match
  if (text.includes(query)) {
    return 0.8
  }

  // Word-level matching
  const queryWords = query.split(/\s+/).filter(w => w.length > 0)
  const textWords = text.split(/\s+/).filter(w => w.length > 0)

  if (queryWords.length === 0) {
    return 0
  }

  // Count how many query words appear in the text
  let matchedWords = 0
  for (const queryWord of queryWords) {
    if (textWords.some(textWord => textWord.includes(queryWord) || queryWord === textWord)) {
      matchedWords++
    }
  }

  // Calculate ratio and cap at 0.9
  const ratio = matchedWords / queryWords.length
  return Math.min(ratio * 0.9, 0.9)
}

/**
 * Checks if a keyword match score passes the threshold for filtering.
 *
 * @param score - The match score (0-1)
 * @param threshold - The minimum score threshold (default: 0.4)
 * @returns True if score meets or exceeds threshold
 */
export function passesKeywordThreshold(score: number, threshold: number = 0.4): boolean {
  return score >= threshold
}

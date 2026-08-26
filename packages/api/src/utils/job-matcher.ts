/**
 * Keyword matching utility for quick filtering of jobs before LLM scoring.
 *
 * Implements language-aware matching that handles the DACH market reality:
 * - German + English stemming/lemmatization (suffix stripping)
 * - A concept map translating common German<->English job terms
 *   ("entwickler" == "developer", "ingenieur" == "engineer", ...)
 * - Whole-word (word-boundary) tech-token matching so "react" matches "react"
 *   but not "reaction", and "kubernetes" matches exactly
 * - Stopword filtering so grammatical noise doesn't dilute scores
 */

export interface KeywordMatchResult {
  /** Score between 0 and 1, indicating match quality */
  score: number
  /** Human-readable explanation of the score */
  reasoning: string
}

/** German + English grammatical stopwords — no signal for job matching. */
const STOPWORDS = new Set([
  // German
  'der','die','das','den','dem','des','ein','eine','einer','einem','eines',
  'und','oder','aber','als','wie','zu','zum','zur','von','vom','mit','nach',
  'bei','aus','fuer','ueber','unter','auf','an','in','im','am','ist','sind',
  'war','waren','wird','werden','wurde','nicht','kein','keine','keinen',
  'auch','noch','nur','sehr','schon','mehr','um','vor','gegen','ohne','seit',
  'wegen','durch','bis','so','wenn','dann','dort','hier','wir','ihr','sie',
  'es','ich','du','er','mich','dich','sich','uns','euch','meine','mein',
  'deine','dein','ihre','unser','euer','bis','sowie','zur','zum','einem',
  // English
  'the','a','an','and','or','but','of','to','in','on','at','by','with',
  'from','for','as','is','are','was','were','be','been','being','have','has',
  'had','do','does','did','not','no','nor','this','that','these','those','it',
  'its','our','your','their','we','you','they','i','he','she','us','them',
  'my','his','her','me','about','into','over','under','after','before',
  'between','during','through','above','below','up','down','out','off','so',
  'than','then','there','here','again','more','most','other','some','such',
  'only','own','same','too','very','just','also','any','all','both','each',
  'few','will','can','may','would','could','should',
])

/**
 * Canonical job/tech concepts. German and English forms of the same role or
 * technology map to one concept so an English query matches German listings.
 */
const CONCEPTS: Record<string, string> = {
  // Roles — English
  developer: 'developer', develop: 'developer', dev: 'developer',
  development: 'developer', programming: 'developer', sde: 'developer',
  engineer: 'engineer', engineering: 'engineer',
  architect: 'architect', architecture: 'architect',
  designer: 'designer', design: 'designer',
  manager: 'manager', management: 'manager', lead: 'lead',
  product: 'product',
  qa: 'qa', test: 'qa', testing: 'qa', tester: 'qa', quality: 'qa',
  devops: 'devops',
  sre: 'sre', reliability: 'sre',
  admin: 'admin', administrator: 'admin', administration: 'admin',
  data: 'data', analyst: 'analyst', analysis: 'analyst',
  scientist: 'scientist',
  cloud: 'cloud',
  // Roles — German
  entwickler: 'developer', entwickl: 'developer', entwicklerin: 'developer',
  entwickel: 'developer', entwicklung: 'developer',
  softwareentwickler: 'developer', softwareentwickl: 'developer',
  ingenieur: 'engineer', ingen: 'engineer', ingenieurin: 'engineer',
  architekt: 'architect', architektin: 'architect',
  designerin: 'designer', gestalter: 'designer',
  leiter: 'manager', leitung: 'manager', leiterin: 'manager',
  produktmanager: 'product', produkt: 'product',
  qualitaetssicherung: 'qa', testerin: 'qa',
  datenanalyst: 'analyst', datenwissenschaftler: 'scientist',
  wissenschaftler: 'scientist', wissenschaftlerin: 'scientist',
  administ: 'admin', systemadministrator: 'admin',
  praktikant: 'intern', praktikantin: 'intern', praktikum: 'intern',
  trainee: 'intern',
  senior: 'senior', junior: 'junior', principal: 'principal',
  fullstack: 'fullstack', 'full-stack': 'fullstack',
  backend: 'backend', 'back-end': 'backend',
  frontend: 'frontend', 'front-end': 'frontend',
  remote: 'remote', vollzeit: 'fulltime', 'vollzeit/': 'fulltime',
  teilzeit: 'parttime',
  // Tech tokens — matched whole-word regardless of language
  python: 'python',
  java: 'java',
  javascript: 'javascript', js: 'javascript',
  typescript: 'typescript', ts: 'typescript',
  react: 'react', reactjs: 'react',
  angular: 'angular', vue: 'vue', vuejs: 'vue',
  node: 'node', nodejs: 'node',
  go: 'go', golang: 'go',
  rust: 'rust', cpp: 'cpp', csharp: 'csharp', php: 'php',
  ruby: 'ruby', rails: 'rails', kotlin: 'kotlin', swift: 'swift',
  aws: 'aws', azure: 'azure', gcp: 'gcp',
  kubernetes: 'kubernetes', k8s: 'kubernetes',
  docker: 'docker', terraform: 'terraform', linux: 'linux', unix: 'linux',
  sql: 'sql', mysql: 'sql', postgres: 'sql', postgresql: 'sql',
  mongodb: 'mongodb', nosql: 'database', database: 'database',
  git: 'git', github: 'git', gitlab: 'git',
  ci: 'cicd', cd: 'cicd', cicd: 'cicd',
  ml: 'ml', ai: 'ai',
  agile: 'agile', scrum: 'agile', kanban: 'agile',
  microservices: 'microservices', api: 'api', apis: 'api', rest: 'api',
  restful: 'api', graphql: 'api',
}

/**
 * German job titles are frequently compound nouns ("Plattformingenieur",
 * "Softwareentwickler"). If a token ends with a known role suffix, treat the
 * whole token as that role — a lightweight compound splitter.
 */
const ROLE_SUFFIXES: Record<string, string> = {
  entwickler: 'developer',
  ingenieur: 'engineer',
  architekt: 'architect',
  designer: 'designer',
  manager: 'manager',
  leiter: 'manager',
  leitung: 'manager',
  techniker: 'technician',
  analyst: 'analyst',
  wissenschaftler: 'scientist',
  tester: 'qa',
  administrator: 'admin',
  developer: 'developer',
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, ' ')
    .trim()
}

function tokenize(text: string): string[] {
  return normalize(text).split(/\s+/).filter(Boolean)
}

/**
 * Light suffix-stripping stemmer covering common English and German
 * inflections ("developers" -> "developer", "entwicklerin" -> "entwickler").
 * Approximate by design; the concept map absorbs the rest.
 */
function stem(token: string): string {
  const min = 4
  // German suffixes (longest-first so "erin" wins over "er").
  const german = ['erin', 'ern', 'em', 'en', 'es', 'er', 'e', 'n', 's']
  const english = ['ies', 'sses', 'es', 's', 'ing', 'ed', 'ly', 'ness', 'ment', 'ers', 'er']

  for (const suffix of german) {
    if (token.length - suffix.length >= min && token.endsWith(suffix)) {
      return token.slice(0, token.length - suffix.length)
    }
  }
  for (const suffix of english) {
    if (token.length - suffix.length >= min && token.endsWith(suffix)) {
      const stemmed = token.slice(0, token.length - suffix.length)
      return suffix === 'ies' ? `${stemmed}y` : stemmed
    }
  }
  return token
}

/** Maps a token to its canonical concept; unknown tokens fall back to their stem. */
function conceptFor(token: string): string {
  const direct = CONCEPTS[token]
  if (direct !== undefined) return direct

  // German compound noun → role concept (e.g. "plattformingenieur").
  for (const [suffix, concept] of Object.entries(ROLE_SUFFIXES)) {
    if (token.length > suffix.length && token.endsWith(suffix)) return concept
  }

  const stemmed = stem(token)
  const viaStem = CONCEPTS[stemmed]
  if (viaStem !== undefined) return viaStem
  return stemmed
}

/** Fraction of query tokens matched by the text's token set. */
function matchRatio(textTokens: string[], queryTokens: string[]): number {
  if (queryTokens.length === 0 || textTokens.length === 0) return 0
  const textConcepts = new Set(textTokens.map(conceptFor))
  let matched = 0
  for (const queryToken of queryTokens) {
    if (textConcepts.has(conceptFor(queryToken))) matched++
  }
  return matched / queryTokens.length
}

/**
 * Calculates keyword similarity between a job title/description and a search
 * query. Language-aware: German and English inflections and common term
 * translations are normalized before matching.
 *
 * Scoring:
 * - Title score = fraction of query tokens matched in the title
 * - With description: (title * 0.7) + (description * 0.3)
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
  const queryTokens = tokenize(query).filter(token => !STOPWORDS.has(token))
  const titleTokens = tokenize(jobTitle)

  if (queryTokens.length === 0) {
    return { score: 0, reasoning: 'Empty query, no keywords to match' }
  }

  const titleRatio = matchRatio(titleTokens, queryTokens)
  let score = titleRatio
  let reasoning = `Title match: ${Math.round(titleRatio * 100)}%`

  if (description) {
    const descTokens = tokenize(description)
    const descRatio = matchRatio(descTokens, queryTokens)
    score = titleRatio * 0.7 + descRatio * 0.3
    reasoning = `Title match: ${Math.round(titleRatio * 100)}%, Description match: ${Math.round(descRatio * 100)}%, Combined: ${Math.round(score * 100)}%`
  }

  const roundedScore = Math.round(score * 100) / 100
  return { score: roundedScore, reasoning }
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
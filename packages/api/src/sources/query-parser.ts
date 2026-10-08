// packages/api/src/sources/query-parser.ts
//
// Rule-based split of a free-text search ("Product Manager in Munich") into the
// role keywords and a location, so query-native sources (Arbeitsagentur `was`/`wo`)
// can scope by place. Deliberately LLM-free: Tier-1 must keep working when the
// LLM provider is rate-limited or down.

export interface ParsedJobQuery {
  keywords: string
  location?: string
  radius?: number // km
}

const DEFAULT_RADIUS_KM = 25

// English / transliterated spellings → the German name the Arbeitsagentur expects.
const CITY_ALIASES: Record<string, string> = {
  munich: 'München',
  muenchen: 'München',
  münchen: 'München',
  cologne: 'Köln',
  koeln: 'Köln',
  köln: 'Köln',
  nuremberg: 'Nürnberg',
  nuernberg: 'Nürnberg',
  nürnberg: 'Nürnberg',
  vienna: 'Wien',
  wien: 'Wien',
  zurich: 'Zürich',
  zuerich: 'Zürich',
  zürich: 'Zürich',
  duesseldorf: 'Düsseldorf',
  düsseldorf: 'Düsseldorf',
  frankfurt: 'Frankfurt am Main',
  berlin: 'Berlin',
  hamburg: 'Hamburg',
  stuttgart: 'Stuttgart',
  leipzig: 'Leipzig',
  dresden: 'Dresden',
  hannover: 'Hannover',
  hanover: 'Hannover',
  bremen: 'Bremen',
  augsburg: 'Augsburg',
  karlsruhe: 'Karlsruhe',
  mannheim: 'Mannheim',
}

// "<role> in|bei|near|nahe|around <place>" — the last preposition wins.
const PREPOSITION_PATTERN = /^(.+)\s+(?:in|bei|near|nahe|around|um)\s+(.+)$/i
// "<role>, <place>"
const COMMA_PATTERN = /^(.+?),\s*(.+)$/

function normalizePlace(place: string): string {
  const alias = CITY_ALIASES[place.toLowerCase()]
  return alias ?? place
}

function withLocation(keywords: string, place: string): ParsedJobQuery {
  return { keywords: keywords.trim(), location: normalizePlace(place.trim()), radius: DEFAULT_RADIUS_KM }
}

// Role families → title variants queried against query-native sources
// (issue #187). A single keyword returns mostly unrelated roles (about 30
// of 52 for "Product Manager"); fanning out across DE+EN titles is the
// biggest quantity lever. LLM-free like the rest of this module.
const TITLE_VARIANTS: Array<{ match: RegExp; variants: string[] }> = [
  {
    match: /produktmanager|product\s?manager|product\s?owner/i,
    variants: [
      'Produktmanager',
      'Product Manager',
      'Product Owner',
      'Senior Product Manager',
      'Technical Product Manager',
    ],
  },
]

// How many variants to query per search. Ship 5; raise toward 8 once the
// valid-rate is measured (issue #187). Overridable without a redeploy.
function maxTitleVariants(): number {
  const fromEnv = Number(process.env.TITLE_VARIANTS_MAX)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.min(Math.floor(fromEnv), 8)
  return 5
}

export function expandTitleVariants(keywords: string): string[] {
  const family = TITLE_VARIANTS.find(f => f.match.test(keywords))
  if (!family) return [keywords]
  return family.variants.slice(0, maxTitleVariants())
}

export function parseJobQuery(raw: string): ParsedJobQuery {
  const query = raw.trim().replace(/\s+/g, ' ')

  const prep = query.match(PREPOSITION_PATTERN)
  if (prep && prep[1].trim() && prep[2].trim()) return withLocation(prep[1], prep[2])

  const comma = query.match(COMMA_PATTERN)
  if (comma && comma[1].trim() && comma[2].trim()) return withLocation(comma[1], comma[2])

  // A known city as the trailing word(s), without a preposition: "Produktmanager München".
  const words = query.split(' ')
  for (let take = Math.min(3, words.length - 1); take >= 1; take--) {
    const place = words.slice(-take).join(' ')
    if (CITY_ALIASES[place.toLowerCase()]) {
      return withLocation(words.slice(0, -take).join(' '), place)
    }
  }

  return { keywords: query }
}

// packages/api/src/sources/__tests__/arbeitsagentur-source.fixtures.ts
// Shapes mirror the live /pc/v6/jobs response (captured 2026-10-06).

function posting(overrides: Record<string, unknown>) {
  return {
    stellenangebotsart: 'ARBEIT',
    arbeitszeitVollzeit: true,
    hauptberuf: 'Produktentwickler/in',
    datumErsteVeroeffentlichung: '2026-09-22',
    homeofficemoeglich: false,
    ...overrides,
  }
}

/** Two well-formed postings. */
export const twoJobsResponse = {
  maxErgebnisse: 2,
  ergebnisliste: [
    posting({
      referenznummer: '10001-1003266561-S',
      stellenangebotsTitel: 'Product Manager (m/w/d)',
      firma: 'Edenred Deutschland GmbH',
      hauptberuf: 'Produktentwickler/in',
      gehaltsspanneVon: 58000.0,
      gehaltsspanneBis: 70000.0,
      homeofficemoeglich: true,
      datumErsteVeroeffentlichung: '2026-06-22',
      stellenlokationen: [
        { adresse: { plz: '81669', ort: 'München', region: 'BAYERN', land: 'DEUTSCHLAND' } },
      ],
    }),
    posting({
      referenznummer: '10000-1208187094-S',
      stellenangebotsTitel: 'Global Product Owner Trailer Business (m/w/d)',
      firma: 'KNORR-BREMSE AG',
      stellenlokationen: [{ adresse: { ort: 'München', region: 'BAYERN' } }],
    }),
  ],
}

/** Builds a full page of `count` distinct postings (refnr prefix keeps pages distinct). */
export function pageResponse(prefix: string, count: number) {
  return {
    maxErgebnisse: 120,
    ergebnisliste: Array.from({ length: count }, (_, i) =>
      posting({
        referenznummer: `${prefix}-${i}-S`,
        stellenangebotsTitel: `Product Manager ${prefix} ${i}`,
        firma: `Firma ${prefix} ${i}`,
        stellenlokationen: [{ adresse: { ort: 'München' } }],
      })
    ),
  }
}

/** Empty result set. */
export const emptyResponse = {
  maxErgebnisse: 0,
  ergebnisliste: [],
}

/** A posting missing optional/expected fields (no employer, no location). */
export const partialJobResponse = {
  maxErgebnisse: 1,
  ergebnisliste: [
    {
      referenznummer: '10000-1100000000-S',
      stellenangebotsTitel: 'Werkstudent Produktmanagement',
      // firma missing
      // stellenlokationen missing
    },
  ],
}

/** Malformed payload — `ergebnisliste` is not an array. */
export const malformedResponse = {
  maxErgebnisse: 'oops',
  ergebnisliste: null,
}

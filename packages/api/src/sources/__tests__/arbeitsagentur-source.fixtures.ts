// packages/api/src/sources/__tests__/arbeitsagentur-source.fixtures.ts

/** Two well-formed postings. */
export const twoJobsResponse = {
  maxErgebnisse: 2,
  stellenangebote: [
    {
      refnr: '10000-1198765432-S',
      titel: 'Senior Python Entwickler (m/w/d)',
      beruf: 'Softwareentwickler/in',
      arbeitgeber: 'ACME GmbH',
      arbeitsort: { ort: 'Berlin', region: 'Berlin', plz: '10115' },
    },
    {
      refnr: '10000-1199999999-S',
      titel: 'Backend Engineer Node.js',
      beruf: 'Softwareentwickler/in',
      arbeitgeber: 'Beispiel AG',
      arbeitsort: { ort: 'München', region: 'Bayern', plz: '80331' },
    },
  ],
}

/** Empty result set. */
export const emptyResponse = {
  maxErgebnisse: 0,
  stellenangebote: [],
}

/** A posting missing optional/expected fields (no employer, no arbeitsort). */
export const partialJobResponse = {
  maxErgebnisse: 1,
  stellenangebote: [
    {
      refnr: '10000-1100000000-S',
      titel: 'Werkstudent Softwareentwicklung',
      // arbeitgeber missing
      // arbeitsort missing
    },
  ],
}

/** Malformed payload — `stellenangebote` is not an array. */
export const malformedResponse = {
  maxErgebnisse: 'oops',
  stellenangebote: null,
}

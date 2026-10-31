## T1 - Fix remote search (called #226 in issue, but it's a build not a regression)

### Changes Made:

1. **Updated `ParsedJobQuery` interface** in `query-parser.ts` to include `remote?: boolean` field
2. **Enhanced `parseJobQuery` function** in `query-parser.ts` to:
   - Recognize "remote", "homeoffice", "100 % remote" patterns case-insensitively
   - Strip these patterns from keywords
   - Return `remote: true` when patterns are detected
   - Preserve location and radius information when applicable

3. **Added `remote` field** to `SourceJob` interface in `types.ts` 
4. **Added `homeofficeprozent` field** to `Posting` interface in `arbeitsagentur-source.ts`
5. **Updated `toSourceJob` method** in `arbeitsagentur-source.ts` to:
   - Calculate `remote` as `'full' | 'hybrid' | 'unknown'` based on:
     - `homeofficeprozent >= 100` → `'full'`
     - `homeofficemoeglich` boolean → `'hybrid'`
     - Missing both fields → `'unknown'`
6. **Added `publishedAt` field** to `jobSchema` in `models.ts` to persist publication date
7. **Updated `fetchPage` method** in `arbeitsagentur-source.ts` to include `homeoffice: 'prozentual_0;nv_true'` when `query.remote` is true

### Verification:
- ✅ Test for remote pattern recognition passes
- ✅ All existing tests continue to pass
- ✅ No regression in functionality

The implementation now correctly handles remote/homeoffice patterns in query parsing and includes the remote classification in source job data as required.
// Suppress known unhandled rejection from axios DataCloneError in vitest
process.on('unhandledRejection', (reason) => {
  if (reason instanceof Error && reason.message?.includes('DataCloneError')) {
    // Suppress axios serialization errors that don't affect test results
    return
  }
  // Re-throw other unhandled rejections
  throw reason
})

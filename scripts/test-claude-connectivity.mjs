#!/usr/bin/env node
/**
 * Demo script: test buildAnthropicClient connectivity with different tokens.
 *
 * Usage:
 *   node scripts/test-claude-connectivity.mjs <token>
 *   node scripts/test-claude-connectivity.mjs sk-ant-api03-...
 *   node scripts/test-claude-connectivity.mjs sk-ant-oat01-...
 *
 * Or set the token via env:
 *   CLAUDE_TOKEN=sk-ant-api03-... node scripts/test-claude-connectivity.mjs
 */

import Anthropic from '@anthropic-ai/sdk'

const OAUTH_PREFIX = 'sk-ant-oat'

function isOAuthToken(token) {
  return token.startsWith(OAUTH_PREFIX)
}

function buildAnthropicClient(token) {
  if (isOAuthToken(token)) {
    console.log('  → detected OAuth token, using Authorization: Bearer + oauth-2025-04-20 beta header')
    return new Anthropic({
      authToken: token,
      defaultHeaders: { 'anthropic-beta': 'oauth-2025-04-20' },
    })
  }
  console.log('  → detected API key, using x-api-key header')
  return new Anthropic({ apiKey: token })
}

async function testConnectivity(token) {
  const masked = token.slice(0, 20) + '...' + token.slice(-4)
  console.log(`\nTesting token: ${masked}`)
  console.log(`Token type:    ${isOAuthToken(token) ? 'OAuth (sk-ant-oat*)' : 'API key'}`)

  const client = buildAnthropicClient(token)

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
    })

    const text = response.content.find(b => b.type === 'text')?.text ?? '(no text)'
    console.log(`✅ Success!`)
    console.log(`   Model:    ${response.model}`)
    console.log(`   Response: ${text.trim()}`)
    console.log(`   Tokens:   ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`)
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      console.log(`❌ Authentication failed (401): ${err.message}`)
    } else if (err instanceof Anthropic.PermissionDeniedError) {
      console.log(`❌ Permission denied (403): ${err.message}`)
    } else if (err instanceof Anthropic.APIError) {
      console.log(`❌ API error (${err.status}): ${err.message}`)
    } else {
      console.log(`❌ Unexpected error: ${err.message}`)
    }
  }
}

// Collect tokens from CLI args and/or CLAUDE_TOKEN env var
const tokens = []

if (process.env.CLAUDE_TOKEN) {
  tokens.push(process.env.CLAUDE_TOKEN)
}

for (const arg of process.argv.slice(2)) {
  tokens.push(arg)
}

if (tokens.length === 0) {
  console.error('No token provided.')
  console.error('Usage: node scripts/test-claude-connectivity.mjs <token> [token2 ...]')
  console.error('   or: CLAUDE_TOKEN=<token> node scripts/test-claude-connectivity.mjs')
  process.exit(1)
}

for (const token of tokens) {
  await testConnectivity(token)
}

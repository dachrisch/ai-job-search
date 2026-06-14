import Anthropic from '@anthropic-ai/sdk'

const OAUTH_PREFIX = 'sk-ant-oat'

export function isOAuthToken(token: string): boolean {
  return typeof token === 'string' && token.startsWith(OAUTH_PREFIX)
}

export function buildAnthropicClient(token: string): Anthropic {
  if (isOAuthToken(token)) {
    return new Anthropic({
      apiKey: null as any,
      authToken: token,
      defaultHeaders: { 'anthropic-beta': 'oauth-2025-04-20' },
    })
  }
  return new Anthropic({ apiKey: token })
}

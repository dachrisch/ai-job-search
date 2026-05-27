import { Anthropic } from '@anthropic-ai/sdk'
import { UserModel } from '../db/models.js'

interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function callClaude(userId: string, message: string): Promise<string> {
  const user = await UserModel.findById(userId)

  if (!user || !user.claudeApiToken) {
    throw new Error('No Claude API token')
  }

  const client = new Anthropic({
    apiKey: user.claudeApiToken,
  })

  const response = await client.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: message,
      },
    ],
  })

  const textContent = response.content.find((block) => block.type === 'text')
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text content in response')
  }

  return textContent.text
}

export async function callClaudeWithHistory(
  userId: string,
  message: string,
  conversationHistory: ConversationMessage[]
): Promise<string> {
  const user = await UserModel.findById(userId)

  if (!user || !user.claudeApiToken) {
    throw new Error('No Claude API token')
  }

  const client = new Anthropic({
    apiKey: user.claudeApiToken,
  })

  const messages = [
    ...conversationHistory,
    {
      role: 'user' as const,
      content: message,
    },
  ]

  const response = await client.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 1024,
    messages: messages,
  })

  const textContent = response.content.find((block) => block.type === 'text')
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text content in response')
  }

  return textContent.text
}

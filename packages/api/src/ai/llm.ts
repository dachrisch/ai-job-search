import { callOpencode, extractFirstJsonValue } from './opencode.js'

/**
 * Runs a prompt against opencode and returns the raw text reply.
 * Throws on failure — callers surface the error (e.g. via search_failed).
 */
export async function callLLM(prompt: string): Promise<string> {
  return callOpencode(prompt)
}

/**
 * Runs a prompt against opencode and parses the first JSON value
 * (object or array) from the reply. Throws on failure or malformed JSON.
 */
export async function callLLMJson<T>(prompt: string): Promise<T> {
  const text = await callOpencode(prompt)
  const json = extractFirstJsonValue(text)
  return JSON.parse(json) as T
}
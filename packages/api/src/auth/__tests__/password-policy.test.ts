import { describe, it, expect } from 'vitest'
import { validatePassword, MIN_PASSWORD_LENGTH } from '../password-policy.js'

describe('validatePassword (audit E1)', () => {
  it('rejects empty / missing passwords', () => {
    expect(validatePassword('').valid).toBe(false)
    expect(validatePassword(undefined as any).valid).toBe(false)
  })

  it(`rejects passwords shorter than ${MIN_PASSWORD_LENGTH} characters`, () => {
    expect(validatePassword('abc').valid).toBe(false)
    const short = 'a'.repeat(MIN_PASSWORD_LENGTH - 1)
    expect(validatePassword(short).valid).toBe(false)
  })

  it('rejects common / weak passwords', () => {
    expect(validatePassword('password').valid).toBe(false)
    expect(validatePassword('12345678').valid).toBe(false)
    expect(validatePassword('qwerty123').valid).toBe(false)
    // case-insensitive
    expect(validatePassword('PASSWORD').valid).toBe(false)
  })

  it('accepts a sufficiently long, non-common password', () => {
    const result = validatePassword('correct-horse-battery-staple')
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('returns a descriptive error message on failure', () => {
    const result = validatePassword('123')
    expect(result.valid).toBe(false)
    expect(typeof result.error).toBe('string')
    expect(result.error!.length).toBeGreaterThan(0)
  })
})

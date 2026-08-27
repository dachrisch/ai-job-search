import { describe, it, expect } from 'vitest'
import jwt from 'jsonwebtoken'
import { verifyToken } from '../auth.service.js'

const SECRET = process.env.JWT_SECRET || 'dev-secret'

describe('verifyToken issuer/audience enforcement (audit E2)', () => {
  it('accepts a token signed with the expected issuer and audience', () => {
    const token = jwt.sign(
      { userId: 'abc', email: 'a@b.com' },
      SECRET,
      { expiresIn: '7d', issuer: process.env.JWT_ISSUER || 'ai-job-search', audience: process.env.JWT_AUDIENCE || 'ai-job-search-clients' },
    )
    const decoded = verifyToken(token)
    expect(decoded.userId).toBe('abc')
    expect(decoded.email).toBe('a@b.com')
  })

  it('rejects a token missing the issuer claim', () => {
    const token = jwt.sign({ userId: 'abc', email: 'a@b.com' }, SECRET, { expiresIn: '7d' })
    expect(() => verifyToken(token)).toThrow('Invalid token')
  })

  it('rejects a token with the wrong audience', () => {
    const token = jwt.sign(
      { userId: 'abc', email: 'a@b.com' },
      SECRET,
      { expiresIn: '7d', issuer: 'ai-job-search', audience: 'evil' },
    )
    expect(() => verifyToken(token)).toThrow('Invalid token')
  })

  it('rejects a tampered / random string', () => {
    expect(() => verifyToken('not-a-real-token')).toThrow('Invalid token')
  })
})

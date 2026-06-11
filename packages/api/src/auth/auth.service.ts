import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { UserModel } from '../db/models.js'
import { AuthResponse } from '@job-search/shared'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret'

export async function registerUser(email: string, password: string, claudeApiToken?: string): Promise<AuthResponse> {
  const existing = await UserModel.findOne({ email })
  if (existing) {
    throw new Error('Email already exists')
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const user = await UserModel.create({ email, passwordHash, claudeApiToken })

  const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' })
  return { userId: user._id.toString(), token }
}

export async function loginUser(email: string, password: string): Promise<AuthResponse> {
  const user = await UserModel.findOne({ email })
  if (!user) {
    throw new Error('Invalid credentials')
  }

  const isValid = await bcrypt.compare(password, user.passwordHash)
  if (!isValid) {
    throw new Error('Invalid credentials')
  }

  const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' })
  return { userId: user._id.toString(), token }
}

export function verifyToken(token: string): { userId: string; email: string } {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string }
    return decoded
  } catch {
    throw new Error('Invalid token')
  }
}

export async function setClaudeToken(userId: string, token: string): Promise<void> {
  // Encrypt token before storing (simplified for MVP)
  await UserModel.findByIdAndUpdate(userId, { claudeApiToken: token })
}

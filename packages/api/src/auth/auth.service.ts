import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { UserModel } from '../db/models.js'
import { AuthResponse } from '@job-search/shared'
import { addToken } from './denylist.js'
import { validatePassword } from './password-policy.js'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret'
const JWT_ISSUER = process.env.JWT_ISSUER || 'ai-job-search'
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'ai-job-search-clients'

const JWT_OPTIONS: jwt.SignOptions = {
  expiresIn: '7d',
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE,
}

export async function registerUser(email: string, password: string): Promise<AuthResponse> {
  const policy = validatePassword(password)
  if (!policy.valid) {
    throw new Error(policy.error || 'Password does not meet policy requirements')
  }

  const existing = await UserModel.findOne({ email })
  if (existing) {
    throw new Error('Email already exists')
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const user = await UserModel.create({ email, passwordHash })

  const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, JWT_OPTIONS)
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

  const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, JWT_OPTIONS)
  return { userId: user._id.toString(), token }
}

export function verifyToken(token: string): { userId: string; email: string } {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }) as { userId: string; email: string }
    return decoded
  } catch {
    throw new Error('Invalid token')
  }
}

export async function getUser(userId: string) {
  const user = await UserModel.findById(userId).select('-passwordHash')
  if (!user) throw new Error('User not found')
  return { userId: user._id.toString(), email: user.email }
}

export async function updateProfile(userId: string, updates: { email?: string }) {
  if (updates.email) {
    const existing = await UserModel.findOne({ email: updates.email, _id: { $ne: userId } })
    if (existing) throw new Error('Email already in use')
  }
  const user = await UserModel.findByIdAndUpdate(userId, { $set: updates }, { new: true }).select('-passwordHash')
  if (!user) throw new Error('User not found')
  return { userId: user._id.toString(), email: user.email }
}

export async function changePassword(userId: string, oldPassword: string, newPassword: string) {
  const user = await UserModel.findById(userId)
  if (!user) throw new Error('User not found')
  const valid = await bcrypt.compare(oldPassword, user.passwordHash)
  if (!valid) throw new Error('Current password is incorrect')
  user.passwordHash = await bcrypt.hash(newPassword, 10)
  await user.save()
}

export async function deleteUser(userId: string) {
  const { SearchSessionModel, JobModel, CompanyModel } = await import('../db/models.js')
  // Delete user's sessions, jobs, and unlink companies
  const sessions = await SearchSessionModel.find({ userId }).select('_id')
  const sessionIds = sessions.map(s => s._id.toString())
  await JobModel.deleteMany({ searchSessionId: { $in: sessionIds } })
  await SearchSessionModel.deleteMany({ userId })
  await UserModel.findByIdAndDelete(userId)
}

export function logoutUser(token: string) {
  // Decode without verification to get expiry (already validated by middleware)
  try {
    const payload = jwt.decode(token) as { exp?: number } | null
    const expiresAtMs = payload?.exp ? payload.exp * 1000 : undefined
    addToken(token, expiresAtMs)
  } catch {
    addToken(token)
  }
}

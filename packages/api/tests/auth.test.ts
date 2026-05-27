import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { registerUser, loginUser } from '../src/auth/auth.service'
import { connectDB, disconnectDB } from '../src/db'
import { UserModel } from '../src/db/models'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'

let mongoServer: MongoMemoryServer

describe('Auth Service', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create()
    const mongoUri = mongoServer.getUri()
    process.env.MONGODB_URI = mongoUri
    await connectDB()
  })

  afterAll(async () => {
    await disconnectDB()
    await mongoServer.stop()
  })

  beforeEach(async () => {
    await UserModel.deleteMany({})
  })

  afterEach(async () => {
    // Cleanup
  })

  it('should register a new user', async () => {
    const result = await registerUser('test@example.com', 'password123')
    expect(result.userId).toBeDefined()
    expect(result.token).toBeDefined()
    expect(result.userId).toBeTypeOf('string')
  })

  it('should reject duplicate email', async () => {
    await registerUser('test@example.com', 'password123')
    await expect(registerUser('test@example.com', 'password123')).rejects.toThrow('Email already exists')
  })

  it('should login existing user', async () => {
    await registerUser('test@example.com', 'password123')
    const result = await loginUser('test@example.com', 'password123')
    expect(result.userId).toBeDefined()
    expect(result.token).toBeDefined()
  })

  it('should reject login with wrong password', async () => {
    await registerUser('test@example.com', 'password123')
    await expect(loginUser('test@example.com', 'wrongpassword')).rejects.toThrow('Invalid credentials')
  })

  it('should reject login for non-existent user', async () => {
    await expect(loginUser('nonexistent@example.com', 'password')).rejects.toThrow('Invalid credentials')
  })
})

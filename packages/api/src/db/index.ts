import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'

let mongoServer: MongoMemoryServer | null = null

export async function connectDB(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/job-search'
  const useMemoryDB = process.env.USE_MEMORY_DB === 'true'

  console.log(`  [DEBUG] USE_MEMORY_DB env: "${process.env.USE_MEMORY_DB}"`)
  console.log(`  [DEBUG] MONGODB_URI env: "${process.env.MONGODB_URI}"`)
  console.log(`  [DEBUG] useMemoryDB boolean: ${useMemoryDB}`)

  try {
    if (useMemoryDB) {
      console.log('  Starting in-memory MongoDB...')
      mongoServer = await MongoMemoryServer.create()
      const uri = mongoServer.getUri()
      console.log('  Connecting to in-memory MongoDB')
      await mongoose.connect(uri)
      console.log('✅ In-memory MongoDB connected')
    } else {
      console.log('  Connecting to:', mongoUri)
      await mongoose.connect(mongoUri, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
        socketTimeoutMS: 5000,
        family: 4,
      })
      console.log('✅ MongoDB connected')
    }
  } catch (error) {
    if (!useMemoryDB) {
      console.error('❌ MongoDB connection error:', error)
      console.log('💡 Tip: Set USE_MEMORY_DB=true to use in-memory MongoDB')
      throw error
    }
    console.error('❌ In-memory MongoDB failed:', error)
    throw error
  }
}

export function getMongoServer(): MongoMemoryServer | null {
  return mongoServer
}

export async function disconnectDB(): Promise<void> {
  try {
    await mongoose.disconnect()
    console.log('MongoDB disconnected')
  } catch (error) {
    console.error('MongoDB disconnection error:', error)
    throw error
  }
}

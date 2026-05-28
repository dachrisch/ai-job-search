import express, { Express, Request, Response, NextFunction } from 'express'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { connectDB } from './db/index.js'
import { registerEventHandlers, initializeQueue } from './events/queue.js'
import { eventHandlers } from './events/handlers.js'
import authRoutes from './routes/auth.js'
import { streamRouter } from './routes/stream.js'
import { SSEManager } from './utils/SSEManager.js'
import searchRoutes from './routes/searches.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
console.log('[CONFIG] Current working directory:', process.cwd())
console.log('[CONFIG] __dirname:', __dirname)
console.log('[CONFIG] USE_MEMORY_DB before dotenv:', process.env.USE_MEMORY_DB)

const envPath1 = path.resolve(__dirname, '../.env')
const envPath2 = path.resolve(__dirname, '../../.env')
console.log('[CONFIG] Trying to load .env from:', envPath1)
console.log('[CONFIG] Trying to load .env from:', envPath2)

dotenv.config({ path: envPath1 })
dotenv.config({ path: envPath2 })

console.log('[CONFIG] USE_MEMORY_DB after dotenv:', process.env.USE_MEMORY_DB)
console.log('[CONFIG] MONGODB_URI after dotenv:', process.env.MONGODB_URI)

const app: Express = express()
const PORT = process.env.PORT || 3000

const sseManager = new SSEManager()

app.use(express.json())

app.use('/api/auth', authRoutes)
app.use('/api/searches', streamRouter(sseManager))
app.use('/api/searches', searchRoutes)

app.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' })
})

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err)
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
})

async function startServer() {
  try {
    console.log('[1/4] Connecting to database...')
    await connectDB()
    console.log('[2/4] Database connected')

    console.log('[3/4] Initializing event queue...')
    await initializeQueue()
    console.log('  Event queue initialized')

    console.log('[4/4] Registering event handlers...')
    const worker = registerEventHandlers(eventHandlers, sseManager)
    console.log('  Event handlers registered')

    console.log('[5/5] Starting server...')
    app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`)
    })
  } catch (error) {
    console.error('❌ Failed to start server:', error)
    process.exit(1)
  }
}

startServer()

export default app
export { sseManager }

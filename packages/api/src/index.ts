import express, { Express, Request, Response, NextFunction } from 'express'
import dotenv from 'dotenv'
import { connectDB } from './db/index.js'
import { registerEventHandlers } from './events/queue.js'
import { eventHandlers } from './events/handlers.js'
import authRoutes from './routes/auth.js'
import searchRoutes from './routes/searches.js'

dotenv.config()

const app: Express = express()
const PORT = process.env.PORT || 3000

app.use(express.json())

app.use('/api/auth', authRoutes)
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
    await connectDB()
    console.log('Database connected')

    registerEventHandlers(eventHandlers)
    console.log('Event handlers registered')

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`)
    })
  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}

startServer()

export default app

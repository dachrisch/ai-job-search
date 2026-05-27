import { Request, Response, NextFunction } from 'express'
import { registerUser, loginUser, setClaudeToken, verifyToken } from './auth.service.js'

export async function handleRegister(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' })
    }
    const result = await registerUser(email, password)
    res.status(201).json(result)
  } catch (error) {
    next(error)
  }
}

export async function handleLogin(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' })
    }
    const result = await loginUser(email, password)
    res.status(200).json(result)
  } catch (error) {
    next(error)
  }
}

export async function handleSetClaudeToken(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization' })
    }

    const token = authHeader.slice(7)
    const { userId } = verifyToken(token)
    const { claudeApiToken } = req.body

    if (!claudeApiToken) {
      return res.status(400).json({ error: 'Claude API token required' })
    }

    await setClaudeToken(userId, claudeApiToken)
    res.status(200).json({ success: true })
  } catch (error) {
    next(error)
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization' })
    }

    const token = authHeader.slice(7)
    const decoded = verifyToken(token)
    ;(req as any).userId = decoded.userId
    next()
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' })
  }
}

import { Request, Response, NextFunction } from 'express'
import { registerUser, loginUser, verifyToken } from './auth.service.js'

export async function handleRegister(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' })
    }
    const result = await registerUser(email, password)
    res.status(201).json(result)
  } catch (error) {
    if (error instanceof Error && error.message === 'Email already exists') {
      return res.status(409).json({ error: 'Email already exists' })
    }
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
    if (error instanceof Error && error.message === 'Invalid credentials') {
      return res.status(401).json({ error: 'Invalid credentials' })
    }
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
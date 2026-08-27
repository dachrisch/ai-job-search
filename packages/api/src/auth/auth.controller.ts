import { Request, Response, NextFunction } from 'express'
import {
  registerUser, loginUser, verifyToken,
  getUser, updateProfile, changePassword, deleteUser, logoutUser
} from './auth.service.js'
import { isDenied } from './denylist.js'

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

export async function handleGetProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).userId
    const user = await getUser(userId)
    res.json(user)
  } catch (error) {
    if (error instanceof Error && error.message === 'User not found') {
      return res.status(404).json({ error: 'User not found' })
    }
    next(error)
  }
}

export async function handleUpdateProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).userId
    const { email } = req.body
    const result = await updateProfile(userId, { email })
    res.json(result)
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'User not found') return res.status(404).json({ error: error.message })
      if (error.message === 'Email already in use') return res.status(409).json({ error: error.message })
    }
    next(error)
  }
}

export async function handleChangePassword(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).userId
    const { currentPassword, newPassword } = req.body
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password required' })
    }
    await changePassword(userId, currentPassword, newPassword)
    // Invalidate the current token on password change
    const authHeader = req.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
      logoutUser(authHeader.slice(7))
    }
    res.json({ message: 'Password updated' })
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'User not found') return res.status(404).json({ error: error.message })
      if (error.message === 'Current password is incorrect') return res.status(401).json({ error: error.message })
    }
    next(error)
  }
}

export async function handleLogout(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
      logoutUser(authHeader.slice(7))
    }
    res.json({ message: 'Logged out' })
  } catch (error) {
    next(error)
  }
}

export async function handleDeleteAccount(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).userId
    // Invalidate the current token
    const authHeader = req.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
      logoutUser(authHeader.slice(7))
    }
    await deleteUser(userId)
    res.json({ message: 'Account deleted' })
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

    // Check denylist first — revoked tokens must be rejected even if not yet expired
    if (isDenied(token)) {
      return res.status(401).json({ error: 'Token has been revoked' })
    }

    const decoded = verifyToken(token)
    ;(req as any).userId = decoded.userId
    next()
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' })
  }
}

import { Router } from 'express'
import { handleRegister, handleLogin, handleSetClaudeToken, authMiddleware } from '../auth/auth.controller.js'

const router = Router()

router.post('/register', handleRegister)
router.post('/login', handleLogin)
router.post('/set-claude-token', authMiddleware, handleSetClaudeToken)

export default router

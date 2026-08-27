import { Router } from 'express'
import {
  handleRegister, handleLogin, handleGetProfile, handleUpdateProfile,
  handleChangePassword, handleLogout, handleDeleteAccount, authMiddleware
} from '../auth/auth.controller.js'
import { registerRateLimiter, loginRateLimiter } from '../middleware/rate-limit.js'

const router = Router()

router.post('/register', registerRateLimiter, handleRegister)
router.post('/login', loginRateLimiter, handleLogin)

// Protected profile/account routes
router.get('/me', authMiddleware, handleGetProfile)
router.patch('/me', authMiddleware, handleUpdateProfile)
router.post('/change-password', authMiddleware, handleChangePassword)
router.post('/logout', authMiddleware, handleLogout)
router.delete('/me', authMiddleware, handleDeleteAccount)

export default router

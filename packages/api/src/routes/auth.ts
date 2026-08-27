import { Router } from 'express'
import {
  handleRegister, handleLogin, handleGetProfile, handleUpdateProfile,
  handleChangePassword, handleLogout, handleDeleteAccount, authMiddleware
} from '../auth/auth.controller.js'

const router = Router()

router.post('/register', handleRegister)
router.post('/login', handleLogin)

// Protected profile/account routes
router.get('/me', authMiddleware, handleGetProfile)
router.patch('/me', authMiddleware, handleUpdateProfile)
router.post('/change-password', authMiddleware, handleChangePassword)
router.post('/logout', authMiddleware, handleLogout)
router.delete('/me', authMiddleware, handleDeleteAccount)

export default router

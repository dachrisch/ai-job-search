import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthContext } from '../hooks/AuthContext'
import { useApi } from '../hooks/useApi'

export function ProfilePage() {
  const { auth, logout } = useAuthContext()
  const { getProfile, updateProfile, changePassword, deleteAccount } = useApi(auth.token)
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState('')

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  useEffect(() => {
    getProfile()
      .then(user => setEmail(user.email))
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load profile'))
      .finally(() => setLoading(false))
  }, [])

  const handleUpdateEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setSuccess('')
    try {
      await updateProfile(email)
      setSuccess('Profile updated')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordError(''); setPasswordSuccess('')
    try {
      await changePassword(currentPassword, newPassword)
      setPasswordSuccess('Password updated')
      setCurrentPassword(''); setNewPassword('')
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Password change failed')
    }
  }

  const handleDelete = async () => {
    try {
      await deleteAccount()
      localStorage.removeItem('auth')
      navigate('/login')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const handleSignOut = async () => {
    await logout()
    navigate('/login')
  }

  if (loading) {
    return <div className="container"><div className="alert alert-info">Loading profile...</div></div>
  }

  return (
    <div className="container">
      <div className="hero">
        <h1 className="display" style={{ fontSize: 28 }}>Profile</h1>
      </div>

      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <form onSubmit={handleUpdateEmail} className="profile-section">
          <h3 style={{ marginBottom: 12 }}>Account</h3>
          {error && <div className="alert alert-error">{error}</div>}
          {success && <div className="alert alert-success">{success}</div>}
          <label className="label">Email</label>
          <input className="input" type="email" value={email}
            onChange={e => setEmail(e.target.value)} style={{ marginBottom: 12 }} />
          <button type="submit" className="btn btn-primary">Save</button>
        </form>

        <form onSubmit={handleChangePassword} className="profile-section">
          <h3 style={{ marginBottom: 12 }}>Change Password</h3>
          {passwordError && <div className="alert alert-error">{passwordError}</div>}
          {passwordSuccess && <div className="alert alert-success">{passwordSuccess}</div>}
          <label className="label">Current password</label>
          <input className="input" type="password" value={currentPassword}
            onChange={e => setCurrentPassword(e.target.value)} style={{ marginBottom: 10 }} />
          <label className="label">New password</label>
          <input className="input" type="password" value={newPassword}
            onChange={e => setNewPassword(e.target.value)} style={{ marginBottom: 12 }} />
          <button type="submit" className="btn btn-primary">Update password</button>
        </form>

        <div className="profile-section">
          <h3 style={{ marginBottom: 12 }}>Actions</h3>
          <button className="btn btn-ghost" onClick={handleSignOut} style={{ marginRight: 8 }}>Sign out</button>

          {!showDeleteConfirm ? (
            <button className="btn btn-danger" onClick={() => setShowDeleteConfirm(true)}>
              Delete account
            </button>
          ) : (
            <div style={{ marginTop: 8 }}>
              <p className="faint" style={{ marginBottom: 8 }}>This will permanently delete your account and all search data.</p>
              <button className="btn btn-danger" onClick={handleDelete} style={{ marginRight: 8 }}>
                Confirm delete
              </button>
              <button className="btn btn-ghost" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

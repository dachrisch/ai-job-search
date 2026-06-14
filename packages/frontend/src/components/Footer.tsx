export function Footer() {
  const version = import.meta.env.VITE_BUILD_VERSION || 'dev'

  return (
    <footer style={{
      textAlign: 'center',
      padding: '12px',
      fontSize: '12px',
      color: '#888',
      borderTop: '1px solid #eee',
      marginTop: 'auto'
    }}>
      done with ❤️ in 🥨 &middot; {version}
    </footer>
  )
}

export function short (v = '', n = 12) {
  return v.length > n ? `${v.slice(0, n)}…` : v
}

export function formatTimestamp (isoString) {
  try {
    return new Date(isoString).toLocaleString()
  } catch {
    return isoString
  }
}

export function formatRelativeTime (isoString) {
  try {
    const date = new Date(isoString)
    const now = new Date()
    const diff = now - date
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 1) return 'just now'
    if (minutes < 60) return `${minutes}m ago`
    if (hours < 24) return `${hours}h ago`
    return `${days}d ago`
  } catch {
    return isoString
  }
}

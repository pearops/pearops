function parseBlindPeerKeys (value) {
  if (!value) return []
  if (Array.isArray(value)) return value.flatMap(parseBlindPeerKeys)
  return String(value).split(',').map(s => s.trim()).filter(Boolean)
}

module.exports = { parseBlindPeerKeys }

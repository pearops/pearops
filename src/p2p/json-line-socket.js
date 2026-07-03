function jsonLineSocket (socket, onMessage) {
  let buffer = ''
  socket.on('data', data => {
    buffer += data.toString('utf8')
    let idx
    while ((idx = buffer.indexOf('\\n')) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line) continue
      try { onMessage(JSON.parse(line)) } catch {}
    }
  })
  return obj => {
    if (!socket.destroyed) socket.write(JSON.stringify(obj) + '\\n')
  }
}

module.exports = { jsonLineSocket }

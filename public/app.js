const state = { snapshot: null }
const $ = sel => document.querySelector(sel)

function toast (msg) {
  const el = $('#toast')
  el.textContent = msg
  el.classList.add('show')
  setTimeout(() => el.classList.remove('show'), 2200)
}

async function postJSON (url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error((await res.json()).error || res.statusText)
  return res.json()
}

$('#createForm').addEventListener('submit', async e => {
  e.preventDefault()
  const data = Object.fromEntries(new FormData(e.target))
  render(await postJSON('/api/create', data))
  toast('Room created. Share the room key with peer B.')
})

$('#joinForm').addEventListener('submit', async e => {
  e.preventDefault()
  const data = Object.fromEntries(new FormData(e.target))
  render(await postJSON('/api/join', data))
  toast('Joined room. Waiting for peer replication...')
})

$('#eventForm').addEventListener('submit', async e => {
  e.preventDefault()
  const data = Object.fromEntries(new FormData(e.target))
  if (!data.message.trim()) return toast('Write a message first')
  await postJSON('/api/event', data)
  e.target.message.value = ''
})

$('#attachForm').addEventListener('submit', async e => {
  e.preventDefault()
  const fd = new FormData(e.target)
  if (!fd.get('file')?.name) return toast('Choose a file first')
  const res = await fetch('/api/attach', { method: 'POST', body: fd })
  if (!res.ok) return toast('Attach failed')
  e.target.reset()
  toast('Attachment added to timeline')
})

for (const btn of document.querySelectorAll('[data-status]')) {
  btn.addEventListener('click', () => postJSON('/api/status', { status: btn.dataset.status }))
}

$('#copyKey').addEventListener('click', async () => {
  await navigator.clipboard.writeText(state.snapshot.roomKey)
  toast('Copied room key')
})

$('#exportBtn').addEventListener('click', async () => {
  const res = await fetch('/api/export', { method: 'POST' })
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'pearops-incident-report.md'
  a.click()
  URL.revokeObjectURL(url)
})

function render (snap) {
  state.snapshot = snap
  if (snap.roomKey) {
    $('#home').classList.add('hidden')
    $('#incident').classList.remove('hidden')
  }
  const meta = snap.metadata || {}
  $('#title').textContent = meta.title || 'Waiting for incident metadata...'
  $('#severity').textContent = meta.severity || 'severity unknown'
  $('#status').textContent = meta.status || 'status unknown'
  $('#peers').textContent = `${snap.peers || 0} peer${snap.peers === 1 ? '' : 's'} connected`
  $('#roomKey').textContent = snap.roomKey || ''
  $('#eventCount').textContent = `${snap.timeline.length} event${snap.timeline.length === 1 ? '' : 's'}`
  $('#timeline').innerHTML = snap.timeline.map(renderEvent).join('') || '<li class="empty">No events yet. Post the first update.</li>'
}

function renderEvent (e) {
  const attachment = e.attachment ? `<a class="attachment" href="/api/attachment?driveKey=${encodeURIComponent(e.attachment.driveKey)}&path=${encodeURIComponent(e.attachment.path)}&name=${encodeURIComponent(e.attachment.name)}">⬇ ${escapeHtml(e.attachment.name)} · ${fmtBytes(e.attachment.size)}</a>` : ''
  return `<li><div class="dot"></div><div class="event"><div class="event-meta"><span>${new Date(e.timestamp).toLocaleTimeString()}</span><b>${escapeHtml(e.eventType)}</b><span>${escapeHtml(e.author)}</span></div><p>${escapeHtml(e.message)}</p>${attachment}</div></li>`
}

function fmtBytes (n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function escapeHtml (s = '') {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

const events = new EventSource('/api/events')
events.addEventListener('snapshot', e => render(JSON.parse(e.data)))
events.addEventListener('timeline-event', () => fetch('/api/state').then(r => r.json()).then(render))

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
  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data
}

async function safe (label, fn) {
  try { return await fn() } catch (err) { toast(`${label}: ${err.message}`) }
}

// Restore active room on page load
fetch('/api/restore').then(r => r.json()).then(snap => { if (snap?.roomKey) render(snap) }).catch(() => {})

$('#createForm').addEventListener('submit', e => {
  e.preventDefault()
  safe('Declare failed', async () => {
    const data = Object.fromEntries(new FormData(e.target))
    render(await postJSON('/api/incidents', data))
    toast('Incident declared. Invite responders with the room key.')
  })
})

$('#joinForm').addEventListener('submit', e => {
  e.preventDefault()
  safe('Join failed', async () => {
    const data = Object.fromEntries(new FormData(e.target))
    render(await postJSON('/api/join', data))
    toast('Joined room. Waiting for peer replication...')
  })
})

$('#eventForm').addEventListener('submit', e => {
  e.preventDefault()
  safe('Post failed', async () => {
    const data = Object.fromEntries(new FormData(e.target))
    if (!data.message.trim()) return toast('Write a message first')
    await postJSON('/api/event', data)
    e.target.message.value = ''
  })
})

$('#attachForm').addEventListener('submit', e => {
  e.preventDefault()
  safe('Attach failed', async () => {
    const fd = new FormData(e.target)
    if (!fd.get('file')?.name) return toast('Choose a file first')
    const res = await fetch('/api/attach', { method: 'POST', body: fd })
    if (!res.ok) return toast('Attach failed')
    e.target.reset()
    $('#fileName').textContent = 'Choose file'
    toast('Attachment added to timeline')
  })
})

$('#evidenceFile').addEventListener('change', e => {
  $('#fileName').textContent = e.target.files?.[0]?.name || 'Choose file'
})

// Lifecycle state transitions
document.querySelectorAll('[data-state]').forEach(btn => {
  btn.addEventListener('click', () => safe('State change failed', async () => {
    render(await postJSON('/api/status', { status: btn.dataset.state }))
  }))
})

// Fetch lifecycle config once and disable invalid transitions
let lifecycleConfig = null
let severityDefinitions = null
let roleDefinitions = null

function loadLifecycleConfig () {
  if (lifecycleConfig) return
  fetch('/api/lifecycle').then(r => r.json()).then(config => {
    lifecycleConfig = config
    updateStateButtons(state.snapshot?.metadata?.state || state.snapshot?.metadata?.status || 'declared')
  }).catch(() => {})
}

function loadSeverityDefinitions () {
  if (severityDefinitions) return
  fetch('/api/severities').then(r => r.json()).then(defs => {
    severityDefinitions = defs
    renderSeverityDefinitions()
    renderArtifactSections(state.snapshot?.metadata?.artifacts || {})
  }).catch(() => {})
}

function loadRoleDefinitions () {
  if (roleDefinitions) return
  fetch('/api/roles').then(r => r.json()).then(data => {
    roleDefinitions = data.roleDefinitions
    renderRoleWarnings(state.snapshot)
    renderRoleBoard(state.snapshot)
  }).catch(() => {})
}

function updateStateButtons (currentState) {
  if (!lifecycleConfig) return
  const allowed = lifecycleConfig.transitions[currentState] || []
  document.querySelectorAll('[data-state]').forEach(btn => {
    const state = btn.dataset.state
    btn.disabled = !allowed.includes(state)
    btn.style.opacity = allowed.includes(state) ? '1' : '0.5'
    btn.style.cursor = allowed.includes(state) ? 'pointer' : 'not-allowed'
  })
}

function renderSeverityDefinitions () {
  if (!severityDefinitions) return
  const defs = Object.values(severityDefinitions).sort((a, b) => a.level - b.level)
  const html = defs.map(d => `<div class="severity-def"><span class="severity-def-name" style="color:${safeColor(d.color)}">${escapeHtml(d.name)}</span><span class="severity-def-desc">${escapeHtml(d.description||'')}</span><span class="severity-def-response">${escapeHtml(d.responseTime||'')}</span></div>`).join('')
  const container = $('#severityDefinitions')
  if (container) container.innerHTML = `<div class="severity-definitions">${html}</div>`
}

function renderArtifactSections () {
  const sections = [
    { id: 'notes', title: 'Incident Notes', desc: 'Collaborative notes during incident response' },
    { id: 'actions', title: 'Action Items', desc: 'Follow-up tasks and owners' },
    { id: 'updates', title: 'Status Updates', desc: 'Stakeholder communications' }
  ]
  const html = sections.map(s => `<div class="artifact-section"><h3>${escapeHtml(s.title)}</h3><p class="artifact-section-desc">${escapeHtml(s.desc)}</p><div class="artifact-section-empty">No ${s.title.toLowerCase()} yet. Phase 2 feature.</div></div>`).join('')
  const container = $('#artifactSections')
  if (container) container.innerHTML = html
}

function safeColor (value) {
  return /^#[0-9a-fA-F]{3,8}$/.test(String(value || '')) ? value : '#626a76'
}

function renderRoleWarnings (snap) {
  const container = $('#roleWarnings')
  if (!container) return
  const warnings = snap?.roleWarnings || []
  if (!warnings.length) {
    container.classList.add('hidden')
    container.innerHTML = ''
    return
  }
  container.classList.remove('hidden')
  const html = warnings.map(w => `<div class="role-warning"><span class="role-warning-icon">⚠</span><span>${escapeHtml(w.message)}</span></div>`).join('')
  container.innerHTML = `<div class="role-warnings-inner">${html}</div>`
}

function renderRoleBoard (snap) {
  const container = $('#roleBoard')
  if (!container) return
  const defs = snap?.roleDefinitions || roleDefinitions || {}
  const roles = snap?.roles || {}
  const ids = Object.keys(defs)
  if (!ids.length) {
    container.innerHTML = ''
    return
  }
  container.innerHTML = `
    <div class="role-board-head">
      <div>
        <p class="eyebrow">Incident roles</p>
        <h2>Current ownership</h2>
      </div>
    </div>
    <div class="role-grid">
      ${ids.map(roleId => renderRoleCard(roleId, defs[roleId], roles[roleId])).join('')}
    </div>
  `
  container.querySelectorAll('[data-role-assign]').forEach(btn => {
    btn.addEventListener('click', () => assignRole(btn.dataset.roleAssign))
  })
  container.querySelectorAll('[data-role-unassign]').forEach(btn => {
    btn.addEventListener('click', () => assignRole(btn.dataset.roleUnassign, true))
  })
}

function renderRoleCard (roleId, def, assignee) {
  const isAssigned = !!assignee
  const responsibilities = (def.responsibilities || []).map(r => `<li>${escapeHtml(r)}</li>`).join('')
  const checklist = (def.checklist || []).map(c => `<li><input type="checkbox" disabled> ${escapeHtml(c)}</li>`).join('')
  return `
    <div class="role-card ${isAssigned ? 'assigned' : 'unassigned'}" data-role="${escapeHtml(roleId)}">
      <div class="role-card-header">
        <h3 class="role-card-title">${escapeHtml(def.name)}</h3>
        ${def.required ? '<span class="role-required-badge">Required</span>' : ''}
      </div>
      <div class="role-owner">
        <span class="role-owner-label">Assignee:</span>
        <span class="role-owner-value">${isAssigned ? escapeHtml(assignee) : '<em>Unassigned</em>'}</span>
      </div>
      <div class="role-assign-input">
        <label>Assignee name
          <input type="text" data-role-assignee="${escapeHtml(roleId)}" value="${isAssigned ? escapeHtml(assignee) : ''}" placeholder="Enter name">
        </label>
        <label>Handoff note
          <input type="text" data-role-note="${escapeHtml(roleId)}" placeholder="Optional note for audit trail">
        </label>
        <div class="role-actions">
          <button class="btn btn-primary" data-role-assign="${escapeHtml(roleId)}" type="button">${isAssigned ? 'Update' : 'Assign'}</button>
          ${isAssigned ? `<button class="btn btn-ghost" data-role-unassign="${escapeHtml(roleId)}" type="button">Unassign</button>` : ''}
        </div>
      </div>
      <div class="role-details">
        <div class="role-responsibilities">
          <h4>Responsibilities</h4>
          <ul>${responsibilities}</ul>
        </div>
        <div class="role-checklist">
          <h4>Checklist</h4>
          <ul>${checklist}</ul>
        </div>
      </div>
    </div>
  `
}

async function assignRole (roleId, unassign = false) {
  await safe('Role update failed', async () => {
    const assigneeEl = document.querySelector(`[data-role-assignee="${roleId}"]`)
    const noteEl = document.querySelector(`[data-role-note="${roleId}"]`)
    const assignee = unassign ? '' : (assigneeEl?.value?.trim() || '')
    const handoffNote = noteEl?.value?.trim() || ''
    if (!unassign && !assignee) return toast('Enter an assignee first')
    await postJSON('/api/roles', { roleId, assignee: unassign ? null : assignee, handoffNote })
    const snap = await fetch('/api/state').then(r => r.json())
    render(snap)
    toast(unassign ? 'Role unassigned' : 'Role assigned')
  })
}

loadLifecycleConfig()
loadSeverityDefinitions()
loadRoleDefinitions()

$('#copyKey').addEventListener('click', () => safe('Copy failed', async () => {
  if (!state.snapshot?.roomKey) return toast('No room key yet')
  await navigator.clipboard.writeText(state.snapshot.roomKey)
  toast('Copied invite key')
}))

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
  if (!snap) return
  state.snapshot = snap
  if (snap.roomKey) {
    $('#home').classList.add('hidden')
    $('#incident').classList.remove('hidden')
  }
  const meta = snap.metadata || {}
  $('#title').textContent = meta.title || 'Waiting for incident metadata...'
  $('#severity').textContent = meta.severity || 'severity unknown'
  $('#state').textContent = meta.state || meta.status || 'state unknown'
  $('#peers').textContent = `${snap.peers || 0} peer${snap.peers === 1 ? '' : 's'} connected`
  $('#blindPeer').textContent = snap.blindPeer?.enabled ? `${snap.blindPeer.registeredCores} blind-peer cores` : 'blind peer off'
  $('#blindPeer').classList.toggle('enabled', !!snap.blindPeer?.enabled)
  $('#roomKey').textContent = snap.roomKey || ''
  const timeline = snap.timeline || []
  $('#eventCount').textContent = `${timeline.length} event${timeline.length === 1 ? '' : 's'}`
  $('#timeline').innerHTML = timeline.map(renderEvent).join('') || '<li class="empty">No events yet. Post the first update.</li>'

  updateStateButtons(meta.state || meta.status || 'declared')
  renderSeverityDefinitions()

  const metaLines = []
  if (meta.description) metaLines.push(`<div class="meta-item"><strong>Description:</strong> ${escapeHtml(meta.description)}</div>`)
  if (meta.affectedServices && meta.affectedServices.length) {
    metaLines.push(`<div class="meta-item"><strong>Affected services:</strong> ${meta.affectedServices.map(escapeHtml).join(', ')}</div>`)
  }
  if (meta.createdAt) metaLines.push(`<div class="meta-item"><strong>Declared:</strong> ${new Date(meta.createdAt).toLocaleString()}</div>`)
  if (meta.declaredBy) metaLines.push(`<div class="meta-item"><strong>Declared by:</strong> ${escapeHtml(meta.declaredBy)}</div>`)
  $('#incident-meta').innerHTML = metaLines.join('') || ''

  // Legacy role badges (compact view) - kept for backward compat
  const roles = snap.roles || meta.roles || {}
  const roleSlots = [
    ['incident_commander', 'Commander'],
    ['communications_lead', 'Comms'],
    ['ops_lead', 'Ops'],
    ['scribe', 'Scribe'],
    ['technical_lead', 'Tech']
  ]
  const roleLines = roleSlots.map(([key, label]) => {
    const value = roles[key]
    return `<span class="role-badge ${value ? '' : 'role-unassigned'}">${label}: ${value ? escapeHtml(value) : 'Unassigned'}</span>`
  })
  $('#incident-roles').innerHTML = roleLines.join('') || ''

  const artifacts = meta.artifacts || {}
  const artifactLinks = []
  if (artifacts.timeline) artifactLinks.push(`<a href="#timeline">Timeline</a>`)
  if (artifacts.notes) artifactLinks.push(`<a href="#notes" title="Notes artifact ID: ${escapeHtml(artifacts.notes)}">Notes</a>`)
  if (artifacts.actions) artifactLinks.push(`<a href="#actions" title="Actions artifact ID: ${escapeHtml(artifacts.actions)}">Actions</a>`)
  if (artifacts.statusUpdates) artifactLinks.push(`<a href="#updates" title="Updates artifact ID: ${escapeHtml(artifacts.statusUpdates)}">Updates</a>`)
  $('#incident-artifacts').innerHTML = artifactLinks.length ? `<div class="artifact-links">${artifactLinks.join(' · ')}</div>` : ''

  renderArtifactSections(artifacts)
  renderRoleWarnings(snap)
  renderRoleBoard(snap)
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
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

const events = new EventSource('/api/events')
events.addEventListener('snapshot', e => render(JSON.parse(e.data)))
events.addEventListener('timeline-event', () => fetch('/api/state').then(r => r.json()).then(render))

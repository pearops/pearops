const assert = require('assert')
const {
  createIncidentId,
  upsertIncident,
  removeIncident,
  findIncident,
  normalizeSeverity,
  normalizeLifecycleState,
  isValidTransition,
  transitionIncidentState,
  normalizeAffectedServices,
  createIncidentDeclaration,
  createAuditEvent,
  getSeverityDefinition,
  getAllSeverityDefinitions,
  getAllIncidentStates,
  INCIDENT_STATES,
  SEVERITY_DEFINITIONS,
  VALID_TRANSITIONS
} = require('../src/app/incidents')

let passed = 0
let failed = 0

function test (name, fn) {
  try {
    fn()
    passed++
  } catch (err) {
    failed++
    console.error(`FAIL: ${name} — ${err.message}`)
  }
}

// createIncidentId
test('createIncidentId starts with inc-', () => {
  const id = createIncidentId()
  assert.ok(id.startsWith('inc-'), 'starts with inc-')
})
test('createIncidentId generates unique IDs', () => {
  const id1 = createIncidentId()
  const id2 = createIncidentId()
  assert.notEqual(id1, id2, 'generates unique IDs')
})

// normalizeSeverity
test('normalizeSeverity SEV2 -> SEV-2', () => {
  assert.strictEqual(normalizeSeverity('SEV2'), 'SEV-2')
})
test('normalizeSeverity sev-0 -> SEV-0', () => {
  assert.strictEqual(normalizeSeverity('sev-0'), 'SEV-0')
})
test('normalizeSeverity SEV-1 stays SEV-1', () => {
  assert.strictEqual(normalizeSeverity('SEV-1'), 'SEV-1')
})
test('normalizeSeverity invalid falls back to SEV-2', () => {
  assert.strictEqual(normalizeSeverity('INVALID'), 'SEV-2')
})
test('normalizeSeverity null falls back to SEV-2', () => {
  assert.strictEqual(normalizeSeverity(null), 'SEV-2')
})
test('normalizeSeverity with custom fallback', () => {
  assert.strictEqual(normalizeSeverity('bad', 'SEV-3'), 'SEV-3')
})

// normalizeLifecycleState
test('normalizeLifecycleState investigating -> triaging', () => {
  assert.strictEqual(normalizeLifecycleState('investigating'), 'triaging')
})
test('normalizeLifecycleState resolved stays resolved', () => {
  assert.strictEqual(normalizeLifecycleState('resolved'), 'resolved')
})
test('normalizeLifecycleState invalid falls back to declared', () => {
  assert.strictEqual(normalizeLifecycleState('INVALID'), 'declared')
})
test('normalizeLifecycleState closed stays closed', () => {
  assert.strictEqual(normalizeLifecycleState('closed'), 'closed')
})

// isValidTransition
test('isValidTransition declared -> triaging is valid', () => {
  assert.strictEqual(isValidTransition('declared', 'triaging'), true)
})
test('isValidTransition triaging -> mitigated is valid', () => {
  assert.strictEqual(isValidTransition('triaging', 'mitigated'), true)
})
test('isValidTransition mitigated -> resolved is valid', () => {
  assert.strictEqual(isValidTransition('mitigated', 'resolved'), true)
})
test('isValidTransition resolved -> closed is valid', () => {
  assert.strictEqual(isValidTransition('resolved', 'closed'), true)
})
test('isValidTransition declared -> resolved is invalid', () => {
  assert.strictEqual(isValidTransition('declared', 'resolved'), false)
})
test('isValidTransition declared -> mitigated is invalid', () => {
  assert.strictEqual(isValidTransition('declared', 'mitigated'), false)
})
test('isValidTransition closed -> declared is valid (reopen)', () => {
  assert.strictEqual(isValidTransition('closed', 'declared'), true)
})
test('isValidTransition null states returns false', () => {
  assert.strictEqual(isValidTransition(null, 'triaging'), false)
})

// transitionIncidentState
test('transitionIncidentState updates state and status', () => {
  const incident = { id: 'inc-1', state: 'declared', status: 'declared' }
  const result = transitionIncidentState(incident, 'triaging', 'alice')
  assert.strictEqual(result.state, 'triaging')
  assert.strictEqual(result.status, 'triaging')
  assert.ok(result.updatedAt)
  assert.strictEqual(result.lastTransitionedBy, 'alice')
})
test('transitionIncidentState rejects invalid transition', () => {
  const incident = { id: 'inc-1', state: 'declared', status: 'declared' }
  assert.throws(() => {
    transitionIncidentState(incident, 'resolved', 'alice')
  }, /Invalid state transition/)
})
test('transitionIncidentState normalizes legacy state names', () => {
  const incident = { id: 'inc-1', state: 'investigating', status: 'investigating' }
  const result = transitionIncidentState(incident, 'mitigated', 'bob')
  assert.strictEqual(result.state, 'mitigated')
})

// normalizeAffectedServices
test('normalizeAffectedServices string to array', () => {
  const result = normalizeAffectedServices('api, web, mobile')
  assert.deepEqual(result, ['api', 'web', 'mobile'])
})
test('normalizeAffectedServices array stays array', () => {
  const result = normalizeAffectedServices(['api', 'web'])
  assert.deepEqual(result, ['api', 'web'])
})
test('normalizeAffectedServices null returns empty array', () => {
  const result = normalizeAffectedServices(null)
  assert.deepEqual(result, [])
})
test('normalizeAffectedServices filters empty strings', () => {
  const result = normalizeAffectedServices('api, , web, ')
  assert.deepEqual(result, ['api', 'web'])
})

// createIncidentDeclaration
test('createIncidentDeclaration returns full incident object', () => {
  const now = '2026-07-06T00:00:00.000Z'
  const incident = createIncidentDeclaration({
    title: 'Test incident',
    description: 'Test description',
    severity: 'SEV1',
    affectedServices: 'api,db',
    declaredBy: 'alice',
    now
  })
  assert.ok(incident.id.startsWith('inc-'))
  assert.strictEqual(incident.title, 'Test incident')
  assert.strictEqual(incident.description, 'Test description')
  assert.strictEqual(incident.severity, 'SEV-1') // normalized
  assert.deepEqual(incident.affectedServices, ['api', 'db'])
  assert.strictEqual(incident.state, 'declared')
  assert.strictEqual(incident.status, 'declared')
  assert.strictEqual(incident.roles.incidentCommander, 'alice')
  assert.ok(incident.artifacts.timeline)
  assert.strictEqual(incident.createdAt, now)
  assert.strictEqual(incident.declaredBy, 'alice')
})
test('createIncidentDeclaration handles defaults', () => {
  const incident = createIncidentDeclaration({})
  assert.strictEqual(incident.title, 'Untitled incident')
  assert.strictEqual(incident.description, '')
  assert.strictEqual(incident.severity, 'SEV-2')
  assert.deepEqual(incident.affectedServices, [])
})

// createAuditEvent
test('createAuditEvent returns audit event object', () => {
  const now = '2026-07-06T00:00:00.000Z'
  const event = createAuditEvent({
    incidentId: 'inc-1',
    type: 'state-change',
    message: 'Transitioned to triaging',
    actor: 'alice',
    timestamp: now,
    details: { from: 'declared', to: 'triaging' }
  })
  assert.ok(event.id.startsWith('audit-'))
  assert.strictEqual(event.incidentId, 'inc-1')
  assert.strictEqual(event.type, 'state-change')
  assert.strictEqual(event.message, 'Transitioned to triaging')
  assert.strictEqual(event.actor, 'alice')
  assert.strictEqual(event.timestamp, now)
  assert.deepEqual(event.details, { from: 'declared', to: 'triaging' })
})

// getSeverityDefinition
test('getSeverityDefinition SEV-0 returns correct definition', () => {
  const def = getSeverityDefinition('SEV-0')
  assert.strictEqual(def.level, 0)
  assert.strictEqual(def.name, 'SEV-0')
  assert.ok(def.description.includes('Critical'))
})
test('getSeverityDefinition invalid returns SEV-2 default', () => {
  const def = getSeverityDefinition('INVALID')
  assert.strictEqual(def.name, 'SEV-2')
})

// getAllSeverityDefinitions
test('getAllSeverityDefinitions returns all 4 severities', () => {
  const defs = getAllSeverityDefinitions()
  assert.ok(defs['SEV-0'])
  assert.ok(defs['SEV-1'])
  assert.ok(defs['SEV-2'])
  assert.ok(defs['SEV-3'])
})

// getAllIncidentStates
test('getAllIncidentStates returns all 5 states', () => {
  const states = getAllIncidentStates()
  assert.deepEqual(states, ['declared', 'triaging', 'mitigated', 'resolved', 'closed'])
})

// upsertIncident, removeIncident, findIncident (legacy tests)
test('upsertIncident - new incident', () => {
  let incidents = []
  const rec1 = { id: 'inc-1', title: 'First', roomKey: 'pearops:abc' }
  upsertIncident(incidents, rec1)
  assert.equal(incidents.length, 1)
  assert.deepEqual(incidents[0], rec1)
})
test('upsertIncident - update by id', () => {
  let incidents = [{ id: 'inc-1', title: 'First' }]
  const rec1Update = { id: 'inc-1', status: 'resolved' }
  upsertIncident(incidents, rec1Update)
  assert.equal(incidents.length, 1)
  assert.equal(incidents[0].status, 'resolved')
  assert.equal(incidents[0].title, 'First', 'preserves other fields')
})
test('removeIncident removes by id', () => {
  const before = [{ id: 'inc-a' }, { id: 'inc-b' }, { id: 'inc-c' }]
  const after = removeIncident(before, 'inc-b')
  assert.equal(after.length, 2)
  assert.deepEqual(after, [{ id: 'inc-a' }, { id: 'inc-c' }])
})
test('findIncident finds by id', () => {
  const before = [{ id: 'inc-a' }, { id: 'inc-b' }]
  const found = findIncident(before, 'inc-b')
  assert.deepEqual(found, { id: 'inc-b' })
  const notFound = findIncident(before, 'inc-x')
  assert.equal(notFound, undefined)
})

console.log(JSON.stringify({ ok: failed === 0, passed, failed }))
process.exit(failed > 0 ? 1 : 0)

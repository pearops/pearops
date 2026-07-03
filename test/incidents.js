const assert = require('assert')
const { createIncidentId, upsertIncident, removeIncident, findIncident } = require('../src/app/incidents')

// createIncidentId
const id1 = createIncidentId()
const id2 = createIncidentId()
assert.ok(id1.startsWith('inc-'), 'starts with inc-')
assert.ok(id1.length > 10, 'has timestamp component')
assert.notEqual(id1, id2, 'generates unique IDs')

// upsertIncident - new incident
let incidents = []
const rec1 = { id: 'inc-1', title: 'First', roomKey: 'pearops:abc' }
upsertIncident(incidents, rec1)
assert.equal(incidents.length, 1)
assert.deepEqual(incidents[0], rec1)

// upsertIncident - update by id
const rec1Update = { id: 'inc-1', status: 'resolved' }
upsertIncident(incidents, rec1Update)
assert.equal(incidents.length, 1)
assert.equal(incidents[0].status, 'resolved')
assert.equal(incidents[0].title, 'First', 'preserves other fields')

// upsertIncident - update by roomKey
const rec2 = { roomKey: 'pearops:abc', title: 'Updated Title' }
upsertIncident(incidents, rec2)
assert.equal(incidents.length, 1)
assert.equal(incidents[0].title, 'Updated Title')

// upsertIncident - prepend new incidents
const rec3 = { id: 'inc-2', title: 'Second' }
upsertIncident(incidents, rec3)
assert.equal(incidents[0].id, 'inc-2', 'new incidents prepended')
assert.equal(incidents[1].id, 'inc-1')

// removeIncident
const before = [{ id: 'inc-a' }, { id: 'inc-b' }, { id: 'inc-c' }]
const after = removeIncident(before, 'inc-b')
assert.equal(after.length, 2)
assert.deepEqual(after, [{ id: 'inc-a' }, { id: 'inc-c' }])

// findIncident
const found = findIncident(before, 'inc-b')
assert.deepEqual(found, { id: 'inc-b' })
const notFound = findIncident(before, 'inc-x')
assert.equal(notFound, undefined)

console.log(JSON.stringify({ ok: true, tests: 14 }))

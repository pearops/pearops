function createIncidentId () {
  return `inc-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function upsertIncident (incidents, record) {
  const idx = incidents.findIndex(i => {
    if (record.id && i.id === record.id) return true
    if (record.roomKey && i.roomKey === record.roomKey) return true
    return false
  })

  if (idx === -1) {
    incidents.unshift(record)
  } else {
    incidents[idx] = { ...incidents[idx], ...record }
  }

  return incidents
}

function removeIncident (incidents, id) {
  return incidents.filter(i => i.id !== id)
}

function findIncident (incidents, id) {
  return incidents.find(i => i.id === id)
}

module.exports = { createIncidentId, upsertIncident, removeIncident, findIncident }

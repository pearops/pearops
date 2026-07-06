// Incident lifecycle states (acceptance criteria: declared → triaging → mitigated → resolved → closed)
const INCIDENT_STATES = ['declared', 'triaging', 'mitigated', 'resolved', 'closed']

// Severity definitions (SEV-0 to SEV-3) - visible and configurable
const SEVERITY_DEFINITIONS = {
  'SEV-0': {
    level: 0,
    name: 'SEV-0',
    description: 'Critical - Complete service outage, data loss, or security breach affecting all users',
    responseTime: 'Immediate',
    color: '#dc2626'
  },
  'SEV-1': {
    level: 1,
    name: 'SEV-1',
    description: 'High - Major functionality impaired for most users',
    responseTime: '15 minutes',
    color: '#ea580c'
  },
  'SEV-2': {
    level: 2,
    name: 'SEV-2',
    description: 'Medium - Partial degradation affecting some users',
    responseTime: '1 hour',
    color: '#ca8a04'
  },
  'SEV-3': {
    level: 3,
    name: 'SEV-3',
    description: 'Low - Minor issue with workaround available',
    responseTime: '4 hours',
    color: '#16a34a'
  }
}

// Legacy severity mappings for backward compatibility
const LEGACY_SEVERITY_MAP = {
  'SEV0': 'SEV-0',
  'SEV1': 'SEV-1',
  'SEV2': 'SEV-2',
  'SEV3': 'SEV-3',
  'sev0': 'SEV-0',
  'sev1': 'SEV-1',
  'sev2': 'SEV-2',
  'sev3': 'SEV-3',
  'sev-0': 'SEV-0',
  'sev-1': 'SEV-1',
  'sev-2': 'SEV-2',
  'sev-3': 'SEV-3'
}

// Legacy lifecycle state mappings for backward compatibility
const LEGACY_STATE_MAP = {
  'investigating': 'triaging',
  'Investigating': 'triaging',
  'INVESTIGATING': 'triaging',
  'identified': 'triaging',
  'Identified': 'triaging',
  'IDENTIFIED': 'triaging',
  'mitigation': 'mitigated',
  'Mitigation': 'mitigated',
  'MITIGATION': 'mitigated',
  'fixing': 'triaging',
  'Fixing': 'triaging',
  'resolved': 'resolved',
  'Resolved': 'resolved',
  'RESOLVED': 'resolved',
  'closed': 'closed',
  'Closed': 'closed',
  'CLOSED': 'closed',
  'declared': 'declared',
  'Declared': 'declared',
  'DECLARED': 'declared',
  'triaging': 'triaging',
  'Triaging': 'triaging',
  'TRIAGING': 'triaging',
  'mitigated': 'mitigated',
  'Mitigated': 'mitigated',
  'MITIGATED': 'mitigated',
  'monitoring': 'resolved',
  'Monitoring': 'resolved'
}

// Valid state transitions (from -> [allowed to states])
// MVP lifecycle: declared → triaging → mitigated → resolved → closed
// Closed can reopen to declared. Triaging can skip to resolved for fast fixes.
const VALID_TRANSITIONS = {
  'declared': ['triaging', 'closed'],
  'triaging': ['mitigated', 'resolved', 'closed'],
  'mitigated': ['resolved', 'closed', 'triaging'],
  'resolved': ['closed', 'triaging'],
  'closed': ['declared'] // Reopen
}

function createIncidentId () {
  return `inc-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function normalizeSeverity (value, fallback = 'SEV-2') {
  if (!value) return fallback
  const normalized = LEGACY_SEVERITY_MAP[value] || value
  if (SEVERITY_DEFINITIONS[normalized]) return normalized
  // Try uppercase normalization
  const upper = normalized.toUpperCase().replace('-', '')
  const mapped = LEGACY_SEVERITY_MAP[upper]
  if (mapped) return mapped
  return fallback
}

function normalizeLifecycleState (value, fallback = 'declared') {
  if (!value) return fallback
  const normalized = LEGACY_STATE_MAP[value] || value
  if (INCIDENT_STATES.includes(normalized)) return normalized
  return fallback
}

function isValidTransition (from, to) {
  if (!from || !to) return false
  const allowed = VALID_TRANSITIONS[from]
  return allowed ? allowed.includes(to) : false
}

function transitionIncidentState (incident, to, actor) {
  const from = normalizeLifecycleState(incident.state || incident.status || 'declared')
  const next = normalizeLifecycleState(to)
  // Allow idempotent transitions (same state)
  if (from === next) {
    return {
      ...incident,
      state: next,
      status: next,
      updatedAt: new Date().toISOString(),
      lastTransitionedBy: actor
    }
  }
  if (!isValidTransition(from, next)) {
    throw new Error(`Invalid state transition from ${from} to ${next}. Allowed: ${VALID_TRANSITIONS[from]?.join(', ') || 'none'}`)
  }
  return {
    ...incident,
    state: next,
    status: next,
    updatedAt: new Date().toISOString(),
    lastTransitionedBy: actor
  }
}

function normalizeAffectedServices (input) {
  if (!input) return []
  if (Array.isArray(input)) return input.filter(Boolean).map(s => String(s).trim()).filter(Boolean)
  if (typeof input === 'string') {
    return input.split(',').map(s => s.trim()).filter(Boolean)
  }
  return []
}

function createIncidentDeclaration ({ title, description, severity, affectedServices, declaredBy, now }) {
  const timestamp = now || new Date().toISOString()
  const incidentId = createIncidentId()
  const normalizedSeverity = normalizeSeverity(severity)
  const normalizedServices = normalizeAffectedServices(affectedServices)

  return {
    id: incidentId,
    title: title || 'Untitled incident',
    description: description || '',
    severity: normalizedSeverity,
    affectedServices: normalizedServices,
    state: 'declared',
    status: 'declared', // Keep status in sync for backward compatibility
    roles: {
      incidentCommander: declaredBy || null,
      communicationsLead: null,
      operationsLead: null,
      scribe: null
    },
    artifacts: {
      timeline: `#${incidentId}-timeline`,
      notes: `#${incidentId}-notes`,
      actions: `#${incidentId}-actions`,
      statusUpdates: `#${incidentId}-updates`
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    declaredBy: declaredBy || null
  }
}

// createAuditEvent - helper for structured audit records (unused in MVP, available for future audit logging)
function createAuditEvent ({ incidentId, type, message, actor, timestamp, details }) {
  return {
    id: `audit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    incidentId,
    type: type || 'update',
    message,
    actor: actor || 'system',
    timestamp: timestamp || new Date().toISOString(),
    details: details || null
  }
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

function getSeverityDefinition (severity) {
  const normalized = normalizeSeverity(severity)
  return SEVERITY_DEFINITIONS[normalized] || SEVERITY_DEFINITIONS['SEV-2']
}

function getAllSeverityDefinitions () {
  return SEVERITY_DEFINITIONS
}

function getAllIncidentStates () {
  return INCIDENT_STATES
}

module.exports = {
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
}

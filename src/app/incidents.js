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

// Canonical incident roles (event-sourced, P2P-synced)
const INCIDENT_ROLES = {
  incident_commander: {
    id: 'incident_commander',
    name: 'Incident Commander',
    required: true,
    responsibilities: [
      'Own the incident response end-to-end',
      'Make final decisions on mitigation strategy',
      'Coordinate all responders and stakeholders',
      'Ensure timeline is kept up to date',
      'Declare incident resolved when appropriate'
    ],
    checklist: [
      'Confirm incident severity and scope',
      'Assign all required roles',
      'Set up communication channel for stakeholders',
      'Document key decisions in timeline',
      'Schedule postmortem if SEV-0/SEV-1'
    ]
  },
  ops_lead: {
    id: 'ops_lead',
    name: 'Ops Lead',
    required: true,
    responsibilities: [
      'Lead technical troubleshooting and mitigation',
      'Coordinate operational changes (deploys, rollbacks, config)',
      'Manage runbook execution',
      'Escalate to additional teams as needed'
    ],
    checklist: [
      'Identify affected services and components',
      'Review recent deploys and changes',
      'Execute diagnostic commands and checks',
      'Implement mitigation or rollback',
      'Verify service recovery'
    ]
  },
  communications_lead: {
    id: 'communications_lead',
    name: 'Communications Lead',
    required: true,
    responsibilities: [
      'Manage all stakeholder communications',
      'Draft and send status updates',
      'Coordinate external communications if needed',
      'Protect responders from interruptions'
    ],
    checklist: [
      'Identify stakeholder groups (internal/external)',
      'Send initial incident notification',
      'Schedule regular update cadence',
      'Prepare post-incident summary for leadership',
      'Update status page if applicable'
    ]
  },
  scribe: {
    id: 'scribe',
    name: 'Scribe',
    required: true,
    responsibilities: [
      'Maintain the incident timeline',
      'Document decisions, actions, and observations',
      'Capture evidence and artifacts',
      'Prepare postmortem draft from timeline'
    ],
    checklist: [
      'Record all timeline events in real-time',
      'Attach relevant logs/screenshots',
      'Note hypotheses and their outcomes',
      'Track action items as they arise',
      'Export timeline for postmortem'
    ]
  },
  technical_lead: {
    id: 'technical_lead',
    name: 'Technical Lead',
    required: true,
    responsibilities: [
      'Provide deep technical expertise',
      'Lead root cause analysis',
      'Review and approve technical fixes',
      'Guide long-term remediation efforts'
    ],
    checklist: [
      'Analyze root cause in detail',
      'Review proposed fixes for safety',
      'Identify preventive measures',
      'Document technical learnings',
      'Plan follow-up technical debt work'
    ]
  }
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

  const declaredByValue = declaredBy || null

  return {
    id: incidentId,
    title: title || 'Untitled incident',
    description: description || '',
    severity: normalizedSeverity,
    affectedServices: normalizedServices,
    state: 'declared',
    status: 'declared', // Keep status in sync for backward compatibility
    roles: {
      // Canonical snake_case (source of truth)
      incident_commander: declaredByValue,
      ops_lead: null,
      communications_lead: null,
      scribe: null,
      technical_lead: null,
      // Legacy camelCase aliases for backward compatibility
      incidentCommander: declaredByValue,
      operationsLead: null,
      communicationsLead: null
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

// Role helpers
function normalizeIncidentRole (roleId) {
  if (!roleId) return null
  const normalized = String(roleId).trim().toLowerCase().replace(/-/g, '_')
  // Legacy camelCase mappings
  const legacy = {
    incidentcommander: 'incident_commander',
    incident_commander: 'incident_commander',
    opslead: 'ops_lead',
    operationslead: 'ops_lead',
    ops_lead: 'ops_lead',
    communicationslead: 'communications_lead',
    communications_lead: 'communications_lead',
    scribe: 'scribe',
    technicallead: 'technical_lead',
    technical_lead: 'technical_lead'
  }
  const compact = normalized.replace(/_/g, '')
  return INCIDENT_ROLES[normalized] ? normalized : (legacy[compact] || legacy[normalized] || null)
}

function getIncidentRole (roleId) {
  const normalized = normalizeIncidentRole(roleId)
  return normalized ? INCIDENT_ROLES[normalized] : null
}

function getAllIncidentRoles () {
  return INCIDENT_ROLES
}

function createEmptyRoleAssignments () {
  const assignments = {}
  for (const roleId of Object.keys(INCIDENT_ROLES)) {
    assignments[roleId] = null
  }
  return assignments
}

function applyRoleEvent (assignments, event) {
  const roleChange = event.role || event.details?.roleChange
  if (!roleChange?.id) return assignments
  const normalized = normalizeIncidentRole(roleChange.id)
  if (!normalized) return assignments
  assignments[normalized] = roleChange.assignee || null
  return assignments
}

function compareTimelineEvents (a, b) {
  // Primary: timestamp
  const tsCmp = (a.timestamp || '').localeCompare(b.timestamp || '')
  if (tsCmp !== 0) return tsCmp
  // Secondary: event id
  const idA = a.id || ''
  const idB = b.id || ''
  const idCmp = idA.localeCompare(idB)
  if (idCmp !== 0) return idCmp
  // Tertiary: author for stability
  return (a.author || '').localeCompare(b.author || '')
}

function deriveRoleAssignments (timeline = [], initialRoles = {}) {
  const assignments = createEmptyRoleAssignments()
  // Apply initial roles first (from metadata.roles or peer.metadata)
  if (initialRoles && typeof initialRoles === 'object') {
    for (const [roleId, assignee] of Object.entries(initialRoles)) {
      const normalized = normalizeIncidentRole(roleId)
      if (normalized && assignee) {
        assignments[normalized] = assignee
      }
    }
  }
  // Then apply role-change events from timeline (last write wins)
  const roleEvents = timeline
    .filter(e => e.eventType === 'role-change' || e.type === 'role-change')
    .slice()
    .sort(compareTimelineEvents)
  for (const event of roleEvents) {
    applyRoleEvent(assignments, event)
  }
  return assignments
}

function getMissingRequiredRoles (assignments) {
  const missing = []
  for (const [roleId, roleDef] of Object.entries(INCIDENT_ROLES)) {
    if (roleDef.required && !assignments[roleId]) {
      missing.push(roleId)
    }
  }
  return missing
}

function createRoleAssignmentEvent ({ roleId, assignee, handoffNote, previousAssignee }) {
  const normalized = normalizeIncidentRole(roleId)
  if (!normalized) throw new Error(`Unknown role: ${roleId}`)
  const roleDef = INCIDENT_ROLES[normalized]
  return {
    eventType: 'role-change',
    message: `${roleDef.name} assigned to ${assignee || 'Unassigned'}${handoffNote ? ` — ${handoffNote}` : ''}`,
    role: {
      id: normalized,
      name: roleDef.name,
      assignee: assignee || null,
      previousAssignee: previousAssignee || null,
      handoffNote: handoffNote || null
    }
  }
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
  VALID_TRANSITIONS,
  INCIDENT_ROLES,
  normalizeIncidentRole,
  getIncidentRole,
  getAllIncidentRoles,
  createEmptyRoleAssignments,
  applyRoleEvent,
  compareTimelineEvents,
  deriveRoleAssignments,
  getMissingRequiredRoles,
  createRoleAssignmentEvent
}

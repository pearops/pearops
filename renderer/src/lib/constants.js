export const WORKER_SPECIFIER = '/workers/main.js'

export const STATUSES = ['all', 'investigating', 'identified', 'monitoring', 'resolved']
export const EVENT_TYPES = ['update', 'investigation', 'mitigation', 'decision']
export const SEVERITIES = ['SEV-0', 'SEV-1', 'SEV-2', 'SEV-3']

export const STATUS_TONES = {
  resolved: 'green',
  monitoring: 'blue',
  identified: 'orange',
  investigating: 'red',
  joined: 'red'
}

export function statusTone (status) {
  return STATUS_TONES[status] || 'red'
}

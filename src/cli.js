const fs = require('fs')
const path = require('path')
const { PearOpsPeer } = require('./peer')

function getArg (flag, fallback = null) {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : fallback
}

async function main () {
  const name = getArg('--name', 'CLI')
  const storage = getArg('--storage', path.join(process.cwd(), '.pearops', name))
  const peer = new PearOpsPeer({ name, storage })
  const cmd = process.argv[2]

  if (cmd === 'create') {
    const snap = await peer.createRoom({ title: getArg('--title', 'Checkout API outage'), severity: getArg('--severity', 'SEV2') })
    console.log(snap.roomKey)
  } else if (cmd === 'post') {
    await peer.joinRoom({ roomKey: getArg('--room') })
    const event = await peer.postEvent({ eventType: getArg('--type', 'update'), message: getArg('--message', '') })
    console.log(JSON.stringify(event, null, 2))
  } else if (cmd === 'attach') {
    await peer.joinRoom({ roomKey: getArg('--room') })
    const attachment = await peer.attachFile(getArg('--file'))
    console.log(JSON.stringify(attachment, null, 2))
  } else if (cmd === 'watch') {
    await peer.joinRoom({ roomKey: getArg('--room') })
    peer.on('event', e => console.log(`${e.timestamp} [${e.eventType}] ${e.author}: ${e.message}`))
    console.log(`watching ${peer.roomKey} as ${name}`)
    return
  } else {
    console.log('Usage: node src/cli.js create|post|attach|watch ...')
  }

  setTimeout(async () => { await peer.close(); process.exit(0) }, 1500)
}

main().catch(err => { console.error(err); process.exit(1) })

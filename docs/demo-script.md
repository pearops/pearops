# PearOps 60-second hackathon demo script

## Pitch

PearOps is a serverless incident war room for engineering teams. When production is down, your incident coordination should not depend on another centralized SaaS. PearOps lets responders create a private peer-to-peer room, share timeline updates and evidence files, and let late joiners catch up through replicated local-first data.

## Live demo

1. Start two peers:

   ```bash
   npm run peer:a -- --open
   npm run peer:b -- --open
   ```

2. Peer A creates `Checkout API outage`.
3. Copy the `pearops:<topic>` room key.
4. Peer B joins with the key.
5. Point out: peers discovered each other with Hyperswarm; no shared backend exists.
6. Peer A posts: `Elevated 500s on checkout since 14:03 UTC.`
7. Peer B posts: `Rollback started for worker release 2026.07.02.`
8. Peer A attaches `evidence.txt` or a screenshot.
9. Peer B downloads the attachment from the timeline.
10. Explain catch-up: each peer writes an append-only Hypercore; when a peer reconnects, Corestore replication downloads missing blocks.

## Closing line

PearOps shows why Pear is compelling for ops tooling: the room, the timeline, and the evidence are local-first and peer-replicated. The coordination channel survives without Slack, Discord, Google Docs, or a central application server.

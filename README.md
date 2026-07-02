# PearOps

PearOps is now a Linux desktop incident response app built from Holepunch's `hello-pear-electron` Pear Runtime template.

It keeps the original hackathon MVP's P2P incident timeline model, but moves the product shape toward a real desktop app:

- **Electron + Pear Runtime template** for Linux packaging and future Pear OTA distribution.
- **React UI** with shadcn-style local components, compact Cloudflare-like colors, small typography, and dense incident-console layout.
- **Keet portable identity keys** via `keet-identity-key`; first-run onboarding creates a mnemonic or restores a previous account, and every local event is signed and verified against the stable identity public key.
- **Local incident list** persisted in app storage. Joined incidents remain available until the user removes them from the app.
- **Status filters** across local incidents: investigating, identified, monitoring, resolved.
- **Full timeline view** for the selected incident.
- **Chat-like event bar** supporting the MVP event values: `update`, `investigation`, `mitigation`, `decision`.
- **Settings placeholder panel** for display name and future notifications/blind-peer/theme controls.

## Repository

Target GitHub namespace: `pearops/pearops`.

The local project lives at:

```bash
~/dev/pearops
```

The previous MVP source was preserved locally at:

```bash
~/dev/_pearops_mvp_snapshot
```

## Development

```bash
npm install
npm run lint
npm test
npm run smoke
```

Run the desktop app:

```bash
npm start
```

Run renderer + Electron in dev mode:

```bash
npm run start:dev
```

Package a Linux app folder:

```bash
npm run package
```

## Architecture

```text
Electron main/preload
  └─ PearRuntime Bare worker (workers/main.js)
       ├─ Local app state: joined incidents + settings
       ├─ PearOpsPeer per selected incident
       ├─ Keet identity mnemonic in app storage
       ├─ Hyperswarm control + replication swarms
       ├─ Hypercore timeline writers
       └─ Hyperdrive attachments

React renderer
  ├─ Incident list + status filters
  ├─ Timeline detail pane
  ├─ Chat/event composer
  └─ Settings placeholders
```

## Identity model

`src/identity.js` wraps `keet-identity-key` and the worker exposes first-run onboarding:

1. On first start, show onboarding if no mnemonic exists.
2. Create a new mnemonic or restore a previous account from an existing mnemonic.
3. Store `identity-mnemonic.txt` in app storage with file mode `0600`.
4. Derive a stable Keet `identityPublicKey`.
5. Generate a per-device keypair.
6. Bootstrap a device proof from the identity.
7. Sign every appended timeline event.
8. Verify replicated events and surface `verified Keet ID` in the UI.

The mnemonic file is sensitive and is not committed.

## Verification output

Latest local verification:

```bash
npm test
# {"ok":true,"identityPublicKey":"…"}
# {"ok":true,"events":3,"status":"identified"}

npm run smoke
# {
#   "ok": true,
#   "roomKey": "pearops:…",
#   "aEvents": 4,
#   "bEvents": 4,
#   "attachment": "evidence.txt"
# }

npm run package
# ✔ Packaging for x64 on linux
```

## Notes

- Attachments are still supported in the P2P core and smoke test. The new compact React UI currently focuses on the incident list, status filters, timeline, event composer, identity, and settings placeholders.
- The package `upgrade` key is a development placeholder and should be replaced with a Pear app key from the production release process.

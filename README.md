<div align="center">
  <img src="assets/logo.svg" width="112" alt="LogCut logo">
  <h1>LogCut</h1>
  <p><em>Edit video by editing text — the open source AI video editor.</em></p>
  <p>
    <a href="https://logcut.com">logcut.com</a> ·
    <a href="https://x.com/LogCutHQ">X @LogCutHQ</a> ·
    <a href="https://www.youtube.com/@LogCutHQ">YouTube</a>
  </p>
  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License"></a>
    <a href="https://github.com/logcut/logcut/releases"><img src="https://img.shields.io/github/v/release/logcut/logcut" alt="Release"></a>
  </p>
</div>

LogCut is built on a simple idea: **editing video should feel like editing text**. Cut a
sentence in the transcript and the timeline cuts with it.

The desktop app keeps your media on your own disk and runs on your own API keys. What we have
released as open source stays open source: we will not relicense it under restrictive terms,
and we will not withdraw it from the open source project.

## Development

```bash
pnpm install
pnpm dev
pnpm verify
```

[`packages/core`](packages/core) is the editing core. It stays platform neutral so that the
desktop app, the web app, and programmatic callers can share one implementation; `pnpm verify`
enforces that boundary.

---

LogCut is a product of Sigmify LLC.

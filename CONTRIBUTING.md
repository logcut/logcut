# Contributing

## What we welcome

- **Bug fixes**, preferred. Include a reproducible case, and a test where the
  behaviour can be covered by one.
- **Features**, by prior agreement only. Open an issue first. We accept features
  that fit the direction of the subsystem they touch, and finding that out after
  the fact costs you a weekend you cannot get back.
- **Issues labelled `help wanted`.** Things we want but are not working on
  ourselves.

Refactors, dependency bumps, and formatting-only changes also need an issue
first.

## Before opening a PR

```bash
pnpm verify
```

Runs the core boundary check, formatting, lint, typecheck, and tests. Commit
messages follow [Conventional Commits](https://www.conventionalcommits.org).

## Sign the CLA

Contributions require a signed [Contributor License Agreement](CLA.md); a bot
will ask you to sign on your first pull request. You keep the copyright to your
work.

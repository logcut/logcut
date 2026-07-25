# Contributing

Open an issue before starting work on a new feature or a refactor. It saves you
from building something we cannot merge.

## Before opening a PR

```bash
pnpm verify
```

Runs the core boundary check, formatting, lint, typecheck, and tests. Commit
messages follow [Conventional Commits](https://www.conventionalcommits.org).

## Sign your commits

LogCut uses the [Developer Certificate of Origin](https://developercertificate.org)
instead of a CLA: you keep the copyright to your work and only certify that it is
yours to submit. Every commit needs a sign-off, which CI checks on each PR.

```bash
git commit -s
```

To fix commits you already made: `git rebase --signoff <base>`, then force-push.

A CLA would ask you to assign or relicense your copyright to us. Apache-2.0
already permits everything we need, including our hosted services,
so there is nothing to sign away.

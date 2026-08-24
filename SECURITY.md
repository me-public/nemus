# Security Policy

## Supported Versions

Nemus is distributed on npm as [`nemus`](https://www.npmjs.com/package/nemus).
Security fixes are released against the **latest** published version. Please
upgrade to the latest release before reporting an issue.

## Reporting a Vulnerability

**Please do not open a public issue for security vulnerabilities.**

Instead, report it privately using GitHub's
[private vulnerability reporting](https://github.com/nemus-cli/nemus/security/advisories/new)
("Report a vulnerability" under the repository's **Security** tab). This creates a
confidential advisory visible only to maintainers.

When reporting, please include:

- A description of the vulnerability and its impact
- Steps to reproduce (a minimal proof of concept if possible)
- The Nemus version (`nemus --version`) and your OS/Node version
- Any suggested remediation

## What to expect

- We aim to acknowledge reports within **3 business days**.
- We'll work with you to understand and validate the issue.
- Once a fix is ready, we'll publish a patched release and, with your consent,
  credit you in the release notes / advisory.

## Scope & good practice

Nemus is a local CLI that shells out to `git` and the GitHub CLI (`gh`) and can
launch third-party agent CLIs. Please keep in mind:

- It executes commands you provide (e.g. `nemus run "<cmd>"`) and post-clone
  suite hooks — treat suites and workspace configs from untrusted sources with
  the same caution as any script.
- It reads/writes agent configuration and skill files under your home directory.

Reports about these documented behaviors are still welcome if you find a way they
can be abused beyond their intent (e.g. injection, privilege escalation, or
leaking secrets).

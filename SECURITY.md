# Security Policy

## Supported Versions

LLM-Guardian maintains security fixes for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| main    | ✅ Yes             |
| 1.6.x   | ✅ Yes             |
| < 1.6   | ❌ No              |

Bug fixes for security issues are backported to the latest `1.6.x` release branch.
Older versions are not patched — please upgrade to the latest release.

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability in LLM-Guardian,
**please do not open a public issue**. Instead, report it privately so we can
coordinate a fix before public disclosure.

### How to report

1. **GitHub Security Advisory**: Use the **Security** tab on the repository and click
   "Report a vulnerability". This is the preferred method and keeps reports private.

2. **Email**: Send details to the repository owner via their GitHub profile contact
   options if the advisory system is unavailable.

### What to include

When reporting, please provide:

- **Description** of the vulnerability and the potential impact.
- **Steps to reproduce** or a proof-of-concept.
- **Affected versions** (commit hash or release tag if known).
- **Any suggested fix** or mitigation you have identified (optional but helpful).

### Response timeline

- **Within 48 hours**: We acknowledge receipt of your report.
- **Within 7 days**: We provide a preliminary assessment and plan.
- **Within 30 days**: We aim to release a fix (or provide a mitigation) for
  confirmed vulnerabilities, depending on severity.

We will keep you informed of progress and coordinate the public disclosure date
with you. Please do not disclose the vulnerability publicly until a fix is
available and deployed.

### Scope

This policy covers vulnerabilities in:

- The LLM-Guardian source code (`src/`)
- The CLI entry point (`src/cli/`)
- The dashboard application (`src/dashboard/`)
- Build and release workflows (`.github/workflows/`)
- Any dependency with a known exploit affecting LLM-Guardian's runtime behavior

Out of scope:

- Vulnerabilities in third-party dependencies that are not directly exploitable
  through LLM-Guardian (report these to the upstream project).
- Issues in forks or modified copies of this repository.
- Denial-of-service vectors that require running untrusted content through the
  optimizer at scale (documented as a usage guideline, not a patch).

## Security Considerations

### Token optimization and untrusted input

LLM-Guardian processes arbitrary LLM prompts and tool outputs. The optimization
engines (folding, sharding, tool fusion, retain filtering) are designed to be
**local-only** — they perform no network calls, no LLM inference, and no file I/O
during the optimization pass. This minimizes the attack surface for prompts
containing adversarial content.

If you extend the optimizer with new passes, ensure they:

- Do not execute or `eval` content from prompts.
- Do not make outbound network requests based on prompt content.
- Sanitize any regex or string operations on untrusted input.
- Stay within the sub-30ms local execution budget (no blocking I/O).

### API keys and credentials

- Never commit API keys, tokens, or credentials to the repository.
- The project uses environment variables (`GUARDIAN_API_KEY`, `OPENROUTER_API_KEY`,
  etc.) for all secrets.
- If you accidentally commit a secret, rotate it immediately and use `git filter-repo`
  to purge it from history.

### Dependency management

- Dependencies are pinned in `bun.lock` (lockfileVersion 1).
- Dependabot PRs are reviewed for both security and compatibility.
- Run `bun audit` before merging dependency updates.

### Code scanning

This repository uses **GitHub CodeQL** for static analysis. All code scanning
alerts are triaged and addressed. If you are fixing a CodeQL alert, follow the
guidance in the alert and add a regression test where applicable.

## Credits

We appreciate responsible disclosure from security researchers. Contributors who
report valid vulnerabilities may be acknowledged in the changelog (unless they
prefer to remain anonymous).

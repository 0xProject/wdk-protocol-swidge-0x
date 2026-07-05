# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.x     | ✅        |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report security issues to the 0x Labs security team at **security@0x.org**.

Include as much of the following as possible:

- A description of the vulnerability and its potential impact.
- Steps to reproduce or a proof-of-concept (if safe to share).
- Any suggested mitigations.

We aim to acknowledge reports within **48 hours** and will provide a remediation timeline as soon as the issue is triaged.

## Scope

This module wraps the 0x Swap API v2. Security issues in the 0x API itself should be reported to 0x Labs directly via the channel above.

### In scope

- Logic errors in fee checking, approval handling, or transaction construction.
- Unsafe use of account keys or signing material.

### Out of scope

- Vulnerabilities in `@tetherto/wdk-wallet` or the 0x API backend.
- Issues that require a compromised dependency supply chain.

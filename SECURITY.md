# Security Policy

## Supported Versions

Only the latest release receives security updates. There are no backported fixes.

| Version | Supported |
|---------|-----------|
| Latest  |    Yes    |
| Older   |    No     |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.** This gives attackers information before a fix is available.

**Preferred:** Use [GitHub private vulnerability reporting](https://github.com/phiil-92/ssh-manager/security/advisories/new) - your report stays confidential until a fix is released.

Please include:
- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof of concept
- The version of SSH Manager affected

You can expect an acknowledgement within 48 hours. A fix or mitigation plan will follow within 14 days depending on severity.

## Scope

**In scope:**
- Authentication bypass or vault access without credentials
- Session token leakage or fixation
- Remote code execution via the terminal or API
- Path traversal or unauthorized file access
- Credentials or secrets exposed in logs, API responses, or error messages
- Cryptographic weaknesses in vault encryption or export format

**Out of scope:**
- Vulnerabilities requiring physical access to the host machine
- Issues in underlying dependencies (Node.js, ssh2, xterm.js) - report those upstream
- Self-XSS or issues requiring the attacker to already be an authenticated vault user
- Brute force without meaningful impact beyond to what rate limiting already prevents
- Attacks requiring the attacker to be on the same machine as the server process

## Known Limitations

SSH Manager is designed for **personal homelab use on a trusted LAN**. The following are known design limitations, not reportable
- No HTTPS by default - credentials travel in plaintext without a reverse proxy
- Single-user vault - there is no multi-user isolation
- No auto-lock timeout - the vault stays unlocked until manually locked

# Security Policy

## Supported versions

Security fixes target the latest published npm version of Craft Code.

## Reporting a vulnerability

Do **not** open a public issue for a vulnerability that could expose credentials, execute unintended commands, bypass permissions, access private repositories or compromise OAuth tokens.

Use GitHub private vulnerability reporting when available, or contact the repository owner privately.

Please include the affected version, OS/Node version, minimal reproduction steps, impact and any suggested remediation. Never include live credentials.

## Security model

Craft Code treats repository content, plugin output and MCP responses as untrusted. File writes, shell commands and external actions are permission-gated by default. Plugin lifecycle hooks are opt-in because they may execute local commands.

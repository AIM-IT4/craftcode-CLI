# Contributing to Craft Code

Thanks for helping improve Craft Code.

## Before you start

- Search existing issues and pull requests before opening a duplicate.
- For substantial behavior or architecture changes, open an issue first.
- Never include API keys, access tokens, private repository contents or user session data in issues, fixtures, commits or screenshots.

## Local development

```bash
git clone https://github.com/AIM-IT4/craftcode-CLI.git
cd craftcode-CLI
npm install
npm test
```

Run locally with:

```bash
node src/index.mjs /path/to/project
```

## Pull requests

1. Create a focused branch.
2. Add or update tests for behavior changes.
3. Run `npm test`.
4. Keep changes small enough to review.
5. Explain user-visible behavior and security implications.

## Coding guidelines

- Preserve permission boundaries around writes, shell execution, plugin hooks and external MCP actions.
- Avoid eagerly injecting skills or connector schemas into model context.
- Treat repository content, plugins and MCP responses as untrusted input.
- Keep Windows, macOS and Linux terminal/filesystem behavior in mind.

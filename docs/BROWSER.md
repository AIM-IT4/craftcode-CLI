# Browser and web research

Craft Code has three browser/research layers.

## Public URL and repository inspection

No browser is required for ordinary public pages and GitHub repositories. The agent can use `fetch_url`, `inspect_repo_url`, and `read_repo_file`. Local/private-network URLs are blocked.

## Chromium with Playwright MCP

Run `/browser` or `/connect playwright`. Craft Code starts Microsoft's official `@playwright/mcp` through npx. Browser tool schemas remain lazy until needed.

## agent-browser / BrowserSkill

Craft Code discovers `SKILL.md` from `.claude/skills`, `.agents/skills`, and Craft Code skill roots. Vercel's agent-browser skill is optional; install the matching agent-browser CLI separately when you want that workflow. Playwright MCP is the built-in browser path.

## Parallel research

`/team 3 compare these repositories: <url1> <url2> <url3>`

Read-only subagents inherit safe public URL/repository tools, so independent research can run concurrently without granting shell or MCP write permissions.

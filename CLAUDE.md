# Meshtastic Web Client - Claude Code Guide

## Claude-Specific Instructions

- **Think First: Before writing code or shell commands, briefly summarize the intended approach and key decisions. Do not expose internal reasoning.**
- **Skills:** The `.skills/` directory contains task-specific instruction modules. Load them as needed — only the skill relevant to your current task.
- **Plan Mode:** Use plan mode for architectural changes spanning multiple modules. Write plans to `.agent_plans/` (git-ignored). The Copilot-CLI-specific `/plan`, `/delegate`, `/research`, and `/share` guidance in `AGENTS.md` does not apply to Claude Code — skip the `<copilot_cli_workflow>` section.

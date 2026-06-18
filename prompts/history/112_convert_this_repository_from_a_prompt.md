# Executed: 2026-06-09T08:27:56.081731

Convert this repository from a Claude-only setup (driven exclusively by `CLAUDE.md`) into a multi-agent-capable setup that works equally well for both Claude Code and Gemini.

Specifically:

1. Create an `AGENTS.md` file at the repository root that serves as the canonical entry point and points to both `CLAUDE.md` and `GEMINI.md`.
2. Create a `GEMINI.md` file that gives Gemini the equivalent project context Claude currently gets from `CLAUDE.md`.
3. Keep `CLAUDE.md` in place so Claude Code continues to work as it does today.

The goal is to share this repository with a collaborator who develops using Gemini, and have the repo be easily readable and usable by both AI coding assistants without either one being a second-class citizen.

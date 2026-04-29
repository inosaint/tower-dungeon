# Assets

This repo can generate pixel-art assets via the OpenAI Images API as an offline step (writes files under `assets/generated/`).

## Setup

1) Copy the example prompts file:
- `cp assets/prompts.example.json assets/prompts.json`

2) Set your OpenAI API key in the environment (recommended), or via a local `.env` file.

Environment (zsh):
- `export OPENAI_API_KEY="YOUR_KEY"`

Or `.env` (never commit):
- `cp .env.example .env` then edit `OPENAI_API_KEY=...`

## Generate

- `node scripts/generate-assets.mjs`

Optional:
- `node scripts/generate-assets.mjs --only wall,exit`
- `node scripts/generate-assets.mjs --force`
- `node scripts/generate-assets.mjs --dry-run`


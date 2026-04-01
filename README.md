# Neural

Generate knowledge graph JSON from markdown documents for the Neural Visualiser.

## Quick Start

```bash
cd your-project
npx neural
# or
node /path/to/neural/src/cli.mjs
```

This will auto-detect: CLAUDE.md → AGENTS.md → AGENT.md → SOUL.md → MEMORY.md → README.md

Output: `./neural/graph.json`

## Usage

```bash
# Auto-detect (default files)
node src/cli.mjs

# Specific file
node src/cli.mjs --file CLAUDE.md

# Custom output path
node src/cli.mjs --output ./my-graph.json
```

## Output

- `neural/graph.json` - Graph data for visualiser
- `neural/summary.md` - Stats and top concepts
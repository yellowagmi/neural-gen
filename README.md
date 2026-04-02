# Neural

Generate 3D knowledge graph in JSON from your agent's markdown documentation.

Neural scans an anchor markdown file, discovers all linked `.md` files, extracts entities/sections/terms, detects shared concepts across files, and outputs a structured graph JSON.

## Quick Start

```bash
cd your-project
node /path/to/neural-gen/src/cli.mjs
```

Auto-detects: `CLAUDE.md` → `AGENTS.md` → `AGENT.md` → `SOUL.md` → `MEMORY.md` → `README.md`

Output: `./neural-graph/` (timestamped `neural_<timestamp>.json` + `summary_<timestamp>.md`)

## Usage

```bash
# Auto-detect anchor file
node src/cli.mjs

# Specific file
node src/cli.mjs --file CLAUDE.md

# Custom output directory
node src/cli.mjs --output ./my-graphs
```

## What it produces

Given a project with markdown docs like `CLAUDE.md`, `AGENTS.md`, `PROJECT.md`, Neural outputs:

- **`neural_<timestamp>.json`** — Nodes (sections, entities, terms) and edges (contains, mentions, cross-file links) clustered by source file
- **`summary_<timestamp>.md`** — Stats, top concepts, and shared cross-file entities

## Install as a Skill

### Claude Code

```bash
# Clone into your skills directory
cd ~/.claude/skills/
git clone https://github.com/yellowagmi/neural-gen.git neural
```

Or add it as a project-level skill:

```bash
cd your-project
mkdir -p .claude/skills
git clone https://github.com/yellowagmi/neural-gen.git .claude/skills/neural
```

### OpenClaw / Other CLI tools

Clone into whichever skills directory your tool uses:

```bash
git clone https://github.com/yellowagmi/neural-gen.git /path/to/skills/neural
```

The skill auto-triggers when you ask Claude to "scan my docs", "generate a knowledge graph", "map my markdown", etc.

## How it works

1. **Anchor detection** — Finds the core `.md` file (auto-detect priority: CLAUDE.md → AGENTS.md → AGENT.md → SOUL.md → MEMORY.md → README.md)
2. **Link discovery** — Extracts all `.md` references from the anchor (markdown links, plain mentions, preposition-style references)
3. **Per-file scanning** — For each file: parses headings into sections, extracts entities (capitalized phrases, acronyms, code refs, camelCase, hyphenated terms), identifies frequent terms
4. **Cross-file detection** — Entities appearing in 2+ files get marked `shared: true` and connected with `cross-file` edges
5. **Graph assembly** — Deduplicates edges, removes disconnected nodes, computes degree centrality

## Graph structure

### Node tiers

| Tier | Description | Size range |
|------|-------------|------------|
| `anchor` | The core markdown file | 50 |
| `file` | Linked markdown files | 30–80 |
| `section` | Headings within files | 2–12 |
| `entity` | Named concepts, acronyms, code refs | 1–8 |
| `term` | Frequently occurring words | 1–6 |

### Edge types

| Type | Meaning |
|------|---------|
| `references` | Anchor → linked file |
| `contains` | File/section → child section |
| `mention` | Section → entity/term |
| `similarity` | Co-occurrence in same sentence |
| `cross-file` | Same entity in multiple files |

### Visualizer hints

- Group by `node.cluster` for per-file galaxies
- `shared: true` nodes bridge clusters
- `node.size` maps directly to visual radius
- `node.degree` indicates connectivity/importance

## Requirements

- Node.js v18+
- No npm dependencies

## License

MIT

---
name: neural
description: >
  Generate knowledge graph JSON from markdown documents for visualization.
  Scans an anchor markdown file (CLAUDE.md, AGENTS.md, SOUL.md, README.md, etc.),
  discovers all linked .md files, extracts sections/entities/terms, detects
  cross-file shared concepts, and outputs a clustered graph JSON + summary.
  Use this skill whenever the user wants to map, scan, graph, or visualize
  their markdown documentation — including phrases like "knowledge graph",
  "scan my docs", "graph my project", "visualize my markdown", "map my codebase",
  "neural graph", "doc graph", "entity map", "concept map from docs",
  "show connections between my files", or any request to extract structure,
  relationships, or entities from .md files. Also trigger when the user mentions
  "neural" in the context of document scanning or graph generation.
---

# Neural — Markdown Knowledge Graph Generator

Scans markdown files and produces a structured knowledge graph JSON for visualization.

## What it does

1. Finds an **anchor file** (the project's core .md document)
2. Discovers all `.md` files linked from the anchor
3. Extracts sections, entities, acronyms, and frequent terms from each file
4. Detects **cross-file shared concepts** (entities appearing in 2+ files)
5. Outputs a `graph.json` (nodes + edges) and `summary.md` (stats + top concepts)

The graph is designed for force-directed or galaxy-style visualization, with clusters per file and shared nodes bridging them.

## How to run it

The scanner is a zero-dependency Node.js script. No `npm install` needed.

### Step 1: Locate the skill scripts

The scripts live at: `<skill-path>/src/cli.mjs`

### Step 2: Run the CLI

```bash
# Auto-detect anchor file in the project root (tries CLAUDE.md → AGENTS.md → AGENT.md → SOUL.md → MEMORY.md → README.md)
node <skill-path>/src/cli.mjs

# Specific anchor file
node <skill-path>/src/cli.mjs --file path/to/CLAUDE.md

# Custom output directory
node <skill-path>/src/cli.mjs --output ./my-output-dir
```

Run the CLI from the **project root** (the directory containing the markdown files). The scanner resolves linked .md paths relative to the anchor file's directory.

### Step 3: Locate the output

The CLI writes two timestamped files into the output directory (default `./neural-graph/`):

- `neural_<timestamp>.json` — The full graph with nodes, edges, and metadata
- `summary_<timestamp>.md` — Human-readable stats and top concepts

### Common patterns

**User says "scan my docs" or "generate a knowledge graph":**
1. Check for markdown files in the project root
2. Run `node <skill-path>/src/cli.mjs` from the project root
3. Present the summary to the user and point them to the graph JSON

**User specifies a file:**
1. Run `node <skill-path>/src/cli.mjs --file <their-file>`
2. Present results

**User wants output in a specific location:**
1. Run `node <skill-path>/src/cli.mjs --output <their-path>`

## Output format

### Graph JSON structure

```json
{
  "meta": {
    "project": "Project Title",
    "anchorFile": "CLAUDE.md",
    "linkedFiles": ["AGENTS.md", "PROJECT.md"],
    "mode": "multi-file-clustered",
    "generated": "ISO timestamp",
    "nodeCount": 150,
    "edgeCount": 800,
    "fileCount": 3,
    "sharedNodes": 45
  },
  "nodes": [
    {
      "id": "n0",
      "label": "Display Name",
      "tier": "anchor | file | section | entity | term",
      "cluster": "FILENAME.md",
      "shared": false,
      "size": 50,
      "degree": 20
    }
  ],
  "edges": [
    {
      "source": "n0",
      "target": "n1",
      "type": "references | contains | mention | similarity | cross-file",
      "weight": 0.8
    }
  ]
}
```

### Node tiers (largest → smallest)

| Tier      | What it represents              | Typical size |
|-----------|----------------------------------|-------------|
| `anchor`  | The core .md file               | 50          |
| `file`    | Linked .md files                | 30–80       |
| `section` | Headings within a file          | 2–12        |
| `entity`  | Named concepts, acronyms, code refs | 1–8     |
| `term`    | Frequently occurring words      | 1–6         |

### Edge types

| Type         | Meaning                                    |
|--------------|---------------------------------------------|
| `references` | Anchor → linked file                       |
| `contains`   | File/section → child section               |
| `mention`    | Section → entity/term appearing in it      |
| `similarity` | Co-occurrence of entities in same sentence |
| `cross-file` | Same entity appearing in multiple files    |

### Layout hints

- Group nodes by `cluster` field (one galaxy per .md file)
- `shared: true` nodes bridge clusters — float them between file groups
- Edge type `cross-file` draws bridges between clusters
- Node `size` drives visual radius directly

## Requirements

- Node.js (any recent version — v18+)
- No npm dependencies

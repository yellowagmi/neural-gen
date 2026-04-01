#!/usr/bin/env node
// Neural — CLI entry point
// Finds the core anchor file (CLAUDE.md / AGENTS.md / etc),
// then doc-scan extracts linked .md files from it automatically.

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOC_SCAN_PATH = join(__dirname, 'doc-scan.mjs');

const PRIORITY_FILES = [
  'CLAUDE.md',
  'AGENTS.md',
  'AGENT.md',
  'SOUL.md',
  'MEMORY.md',
  'README.md',
];

const args = process.argv.slice(2);
let inputFile = null;
let outputPath = './neural-graph';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--file' && args[i + 1]) {
    inputFile = args[i + 1];
    i++;
  } else if (args[i] === '--output' && args[i + 1]) {
    outputPath = args[i + 1];
    i++;
  } else if (args[i] === '--help') {
    console.log(`
Neural — Generate knowledge graph from markdown

Usage:
  neural                    # Auto-detect anchor file
  neural --file <path>      # Specific anchor file
  neural --output <path>    # Custom output path

Auto-detect order: CLAUDE.md → AGENTS.md → AGENT.md → SOUL.md → MEMORY.md → README.md

The anchor file is the core (biggest) node. Any .md files linked within it
become second-tier nodes, each with their own cluster of sections/entities.
`);
    process.exit(0);
  } else if (!args[i].startsWith('--')) {
    inputFile = args[i];
  }
}

if (!inputFile) {
  const cwd = process.cwd();
  for (const filename of PRIORITY_FILES) {
    const path = join(cwd, filename);
    if (existsSync(path)) {
      inputFile = path;
      console.log(`Found anchor: ${filename}`);
      break;
    }
  }
  if (!inputFile) {
    console.error('No anchor file found. Create one of:', PRIORITY_FILES.join(', '));
    process.exit(1);
  }
} else {
  if (!existsSync(inputFile)) {
    console.error(`File not found: ${inputFile}`);
    process.exit(1);
  }
}

console.log(`Anchor: ${inputFile}`);

const { scan } = await import(DOC_SCAN_PATH);
scan(inputFile, outputPath);

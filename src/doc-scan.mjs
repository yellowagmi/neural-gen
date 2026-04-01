#!/usr/bin/env node
// Neural — multi-file clustered graph scanner
//
// Structure:
//   1. Reads the core anchor file (CLAUDE.md / AGENTS.md / etc)
//   2. Extracts all linked .md files from the anchor
//   3. Core anchor → biggest node (size 30)
//   4. Linked .md files → second-tier nodes (size 18), connected to anchor
//   5. Sections / entities / terms per file → clustered under their file node
//   6. Nodes appearing in multiple files → marked shared:true, sized up,
//      edges drawn to each file they appear in (they float between clusters)
//
// Output fields used by visualiser:
//   node.cluster   — filename the node belongs to (for layout grouping)
//   node.shared    — true if node appears in 2+ files (cross-cutting concept)
//   node.size      — drives visual radius
//   node.tier      — 'anchor' | 'file' | 'section' | 'entity' | 'term'

import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'fs';
import { join, basename, dirname, resolve } from 'path';

const STOPWORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','as',
  'is','are','was','were','it','its','this','that','be','been','have','has',
  'from','by','not','we','you','they','he','she','will','can','should','would',
  'could','may','might','must','shall','do','does','did','i','my','your','our',
  'their','if','then','else','when','where','which','who','what','how','why',
  'also','more','some','all','any','each','no','so','than','about','into',
  'use','using','used','make','makes','made','get','gets','set','run','runs',
  'via','per','see','note','example','used','new','first','next','last','etc',
  'one','two','three','only','just','very','most','other','these','those',
  'after','before','while','during','between','within','without',
]);

// ─── text helpers ────────────────────────────────────────────────────────────

function parseMarkdown(raw) {
  const lines = raw.split('\n');
  const sections = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (current) sections.push(current);
      current = {
        level: headingMatch[1].length,
        rawTitle: headingMatch[2].trim(),
        title: cleanText(headingMatch[2]),
        lines: [],
        startLine: i,
      };
    } else if (current) {
      const stripped = line.trim();
      if (stripped) current.lines.push(stripped);
    }
  }
  if (current) sections.push(current);

  const preambleLines = [];
  for (const line of lines) {
    if (line.match(/^#{1,6}\s/)) break;
    if (line.trim()) preambleLines.push(line.trim());
  }

  return { sections, preambleLines };
}

function cleanText(s) {
  return s
    .replace(/`[^`]*`/g, m => m.slice(1,-1))
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#`*_>~]/g, '')
    .trim();
}

function extractEntities(text) {
  const entities = new Set();

  const codeRefs = text.match(/`([^`\n]{2,40})`/g) || [];
  codeRefs.forEach(r => {
    const clean = r.slice(1,-1).trim();
    if (clean.length >= 2 && clean.length <= 40) entities.add(clean);
  });

  const quoted = text.match(/["']([A-Z][a-zA-Z0-9\s_-]{2,30})["']/g) || [];
  quoted.forEach(r => {
    const clean = r.slice(1,-1).trim();
    if (clean) entities.add(clean);
  });

  const capPhrases = text.match(/(?<![.!?]\s)(?<!\n)\b([A-Z][a-z]{1,15})(\s[A-Z][a-z]{1,15}){0,2}\b/g) || [];
  capPhrases.forEach(p => {
    const clean = p.trim();
    if (clean.length >= 4 && !STOPWORDS.has(clean.toLowerCase())) entities.add(clean);
  });

  const acronyms = text.match(/\b[A-Z]{2,10}\b/g) || [];
  acronyms.forEach(a => entities.add(a));

  const camel = text.match(/\b[a-z][a-zA-Z0-9]{3,30}\b/g) || [];
  camel.forEach(c => {
    if (/[A-Z]/.test(c) && !STOPWORDS.has(c.toLowerCase())) entities.add(c);
  });

  const hyphenated = text.match(/\b[a-z]{2,15}-[a-z]{2,15}(?:-[a-z]{2,15})?\b/g) || [];
  hyphenated.forEach(h => {
    if (!STOPWORDS.has(h.split('-')[0])) entities.add(h);
  });

  return [...entities].filter(e => e.length >= 2 && e.length <= 50);
}

function extractFrequentTerms(allText, topN = 30) {
  const words = allText.toLowerCase().match(/\b[a-z][a-z0-9_-]{3,20}\b/g) || [];
  const freq = {};
  words.forEach(w => {
    if (!STOPWORDS.has(w)) freq[w] = (freq[w] || 0) + 1;
  });
  return Object.entries(freq)
    .filter(([,c]) => c >= 3)
    .sort((a,b) => b[1]-a[1])
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }));
}

function toSentences(text) {
  return text
    .split(/(?<=[.!?])\s+|(?<=\n)[-*•]\s*|[\n]{2,}/)
    .map(s => s.trim())
    .filter(s => s.length > 10);
}

function textFromLines(lines) {
  return lines
    .map(l => l.replace(/^[-*•]\s*/, '').replace(/^\d+\.\s*/, ''))
    .join(' ');
}

// ─── extract .md links from anchor file ──────────────────────────────────────

function extractLinkedMdFiles(raw, anchorDir) {
  const linked = [];
  const foundPaths = new Set();

  function addFile(path) {
    const fullPath = resolve(anchorDir, path.split('#')[0].split('?')[0].trim());
    if (existsSync(fullPath) && !foundPaths.has(fullPath)) {
      foundPaths.add(fullPath);
      linked.push({ path: fullPath, filename: basename(fullPath), linkText: '' });
    }
  }

  // Pattern 1: Markdown links [text](path.md)
  const linkRe = /\[([^\]]*)\]\(([^)]+\.md[^)]*)\)/gi;
  let m;
  while ((m = linkRe.exec(raw)) !== null) {
    addFile(m[2]);
  }

  // Pattern 2: Plain text mentions - "See FILENAME.md", "Read FILENAME.md", etc.
  const plainRe1 = /(?:See|Read|Follow|Check|Refer to|Open|see|read|follow|check|refer to|open)\s+([^\s,]+\.md)/gi;
  while ((m = plainRe1.exec(raw)) !== null) {
    addFile(m[1]);
  }

  // Pattern 3: Preposition-style mentions - "according to FILENAME.md", etc.
  const plainRe2 = /\b(?:according to|as shown in|based on|described in|documented in|from|given in|listed in|mentioned in|provided in|referenced in|shown in|specified in|stated in|defined in|outlined in|covered in)\s+([^\s,]+\.md)\b/gi;
  while ((m = plainRe2.exec(raw)) !== null) {
    addFile(m[1]);
  }

  // Pattern 4: Simple .md filename mentions anywhere
  const plainRe3 = /\b([A-Za-z][A-Za-z0-9_\-\/]*\.md)\b/g;
  while ((m = plainRe3.exec(raw)) !== null) {
    addFile(m[1]);
  }

  return linked;
}

// ─── node id generator ───────────────────────────────────────────────────────

let _nid = 0;
const nid = () => `n${_nid++}`;

// ─── scan a single file, return its nodes/edges/entityKeys ───────────────────

function scanFile(filePath, fileNodeId, clusterName, stat) {
  const raw = readFileSync(filePath, 'utf8');
  const filename = basename(filePath);
  const { sections, preambleLines } = parseMarkdown(raw);
  const allText = raw;
  const frequentTerms = extractFrequentTerms(allText);

  const nodes = [];
  const edges = [];
  const sectionNodeMap = {};
  const sectionEntityMap = {};

  // ── section nodes ──
  sections.forEach((sec, idx) => {
    const secText = textFromLines(sec.lines);
    const secSize = Math.max(2, Math.min(12, Math.ceil(sec.lines.length / 2)));
    const id = nid();
    sectionNodeMap[idx] = id;

    nodes.push({
      id,
      label: sec.title.length > 40 ? sec.title.slice(0, 38) + '…' : sec.title,
      path: `${filename}#${sec.rawTitle.toLowerCase().replace(/\s+/g,'-')}`,
      type: sec.level <= 3 ? 'doc' : 'code',
      subtype: 'section',
      tier: 'section',
      cluster: clusterName,
      shared: false,
      anchor: false,
      size: secSize,
      degree: 0,
      modified: stat ? Math.floor(stat.mtimeMs / 1000) : 0,
      keywords: extractFrequentTerms(secText, 5).map(t => t.word),
      description: `${sec.level <= 3 ? 'Section' : 'Subsection'} in ${filename} — ${sec.lines.length} lines`,
      level: sec.level,
    });

    sectionEntityMap[idx] = new Set(extractEntities(sec.rawTitle + '\n' + secText));

    // top-level sections attach to file node; deeper sections to nearest parent
    if (sec.level <= 2) {
      edges.push({ source: fileNodeId, target: id, type: 'contains', weight: 0.5 });
    } else {
      let parentId = fileNodeId;
      for (let pi = idx - 1; pi >= 0; pi--) {
        if (sections[pi].level < sec.level && sectionNodeMap[pi]) {
          parentId = sectionNodeMap[pi];
          break;
        }
      }
      edges.push({ source: parentId, target: id, type: 'contains', weight: 0.4 });
    }
  });

  // ── entity map ──
  const globalEntityMap = {};

  sections.forEach((sec, idx) => {
    const entities = sectionEntityMap[idx] || new Set();
    entities.forEach(entity => {
      const key = entity.toLowerCase();
      if (!globalEntityMap[key]) {
        globalEntityMap[key] = { id: nid(), label: entity, sections: new Set(), count: 0 };
      }
      globalEntityMap[key].sections.add(idx);
      globalEntityMap[key].count++;
    });
  });

  if (preambleLines.length) {
    extractEntities(preambleLines.join(' ')).forEach(entity => {
      const key = entity.toLowerCase();
      if (!globalEntityMap[key]) {
        globalEntityMap[key] = { id: nid(), label: entity, sections: new Set([-1]), count: 1 };
      }
    });
  }

  const freqTermSet = new Set(frequentTerms.map(t => t.word));

  const keptEntities = Object.entries(globalEntityMap).filter(([key, data]) => {
    if (data.label.startsWith('`') || /^[A-Z]{2,}$/.test(data.label)) return true;
    if (data.sections.size >= 2) return true;
    if (freqTermSet.has(key)) return true;
    if (data.label.includes('-')) return true;
    if (/[A-Z]/.test(data.label[0]) && data.label.length >= 4) return true;
    return false;
  });

  const topEntities = keptEntities
    .sort((a,b) => (b[1].sections.size - a[1].sections.size) || (b[1].count - a[1].count))
    .slice(0, 60);

  topEntities.forEach(([key, data]) => {
    const isFrequent = freqTermSet.has(key);
    const isTechnical = /`/.test(data.label) || data.label.includes('-') || /^[A-Z]{2,}$/.test(data.label);

    nodes.push({
      id: data.id,
      label: data.label.length > 35 ? data.label.slice(0,33) + '…' : data.label,
      path: `${filename}::${data.label}`,
      type: isTechnical ? 'config' : (isFrequent ? 'shell' : 'config'),
      subtype: 'entity',
      tier: 'entity',
      cluster: clusterName,
      shared: false,
      anchor: false,
      size: Math.max(1, Math.min(8, data.sections.size * 2 + 1)),
      degree: 0,
      modified: stat ? Math.floor(stat.mtimeMs / 1000) : 0,
      keywords: [],
      description: `Appears in ${data.sections.size} section(s) of ${filename}`,
      sectionCount: data.sections.size,
    });

    data.sections.forEach(secIdx => {
      const secNodeId = secIdx === -1 ? fileNodeId : sectionNodeMap[secIdx];
      if (secNodeId && secNodeId !== data.id) {
        edges.push({
          source: data.id,
          target: secNodeId,
          type: 'mention',
          weight: Math.min(1.0, 0.3 + data.sections.size * 0.15),
        });
      }
    });
  });

  // ── co-occurrence edges between entities ──
  sections.forEach((sec) => {
    const sentences = toSentences(textFromLines(sec.lines));
    sentences.forEach(sentence => {
      const present = topEntities.filter(([key, data]) =>
        sentence.toLowerCase().includes(key) || sentence.includes(data.label)
      );
      for (let i = 0; i < present.length; i++) {
        for (let j = i + 1; j < present.length; j++) {
          const aId = present[i][1].id;
          const bId = present[j][1].id;
          if (aId === bId) continue;
          const exists = edges.some(e =>
            (e.source === aId && e.target === bId) ||
            (e.source === bId && e.target === aId)
          );
          if (!exists) edges.push({ source: aId, target: bId, type: 'similarity', weight: 0.2 });
        }
      }
    });
  });

  // ── frequent term nodes ──
  const existingLabels = new Set(nodes.map(n => n.label.toLowerCase()));
  frequentTerms.slice(0, 20).forEach(({ word, count }) => {
    if (existingLabels.has(word)) return;
    const termId = nid();
    nodes.push({
      id: termId,
      label: word,
      path: `${filename}::term::${word}`,
      type: 'shell',
      subtype: 'term',
      tier: 'term',
      cluster: clusterName,
      shared: false,
      anchor: false,
      size: Math.max(1, Math.min(6, Math.ceil(count / 3))),
      degree: 0,
      modified: stat ? Math.floor(stat.mtimeMs / 1000) : 0,
      keywords: [],
      description: `Appears ${count} times in ${filename}`,
      frequency: count,
    });

    let connectedTo = 0;
    sections.forEach((sec, idx) => {
      if (connectedTo >= 3) return;
      const secText = (sec.rawTitle + ' ' + textFromLines(sec.lines)).toLowerCase();
      const termCount = (secText.match(new RegExp(`\\b${word}\\b`, 'g')) || []).length;
      if (termCount >= 2 && sectionNodeMap[idx]) {
        edges.push({
          source: termId,
          target: sectionNodeMap[idx],
          type: 'mention',
          weight: Math.min(0.5, 0.2 + termCount * 0.05),
        });
        connectedTo++;
      }
    });

    if (connectedTo === 0) {
      edges.push({ source: fileNodeId, target: termId, type: 'anchor', weight: 0.1 });
    }
    existingLabels.add(word);
  });

  // entity keys returned for cross-file shared detection
  const entityKeys = topEntities.map(([key, data]) => ({ key, id: data.id, label: data.label }));

  return { nodes, edges, entityKeys, sections: sections.length };
}

// ─── main export ─────────────────────────────────────────────────────────────

export function scan(inputFile, outputPath = './neural') {
  const INPUT_FILE = resolve(inputFile);
  const OUTPUT_DIR = resolve(outputPath);
  const anchorDir = dirname(INPUT_FILE);

  console.log(`\nNeural — anchor: ${INPUT_FILE}\n`);

  let anchorRaw;
  try { anchorRaw = readFileSync(INPUT_FILE, 'utf8'); }
  catch (e) { console.error(`Cannot read file: ${INPUT_FILE}`); process.exit(1); }

  let anchorStat;
  try { anchorStat = statSync(INPUT_FILE); } catch { anchorStat = null; }

  const anchorFilename = basename(INPUT_FILE);
  const { sections: anchorSections } = parseMarkdown(anchorRaw);
  const firstH1 = anchorSections.find(s => s.level === 1);
  const anchorTitle = firstH1 ? firstH1.title : anchorFilename.replace(/\.md$/i, '');

  // ── find linked .md files ──
  const linkedFiles = extractLinkedMdFiles(anchorRaw, anchorDir);
  console.log(`Linked .md files found: ${linkedFiles.length}`);
  linkedFiles.forEach(f => console.log(`  → ${f.filename}`));

  const allNodes = [];
  const allEdges = [];

  // ── anchor node (tier 1, biggest) ──
  const anchorNodeId = nid();
  allNodes.push({
    id: anchorNodeId,
    label: anchorTitle,
    path: anchorFilename,
    type: 'doc',
    subtype: 'anchor',
    tier: 'anchor',
    cluster: anchorFilename,
    shared: false,
    anchor: true,
    size: 50,
    degree: 0,
    modified: anchorStat ? Math.floor(anchorStat.mtimeMs / 1000) : 0,
    keywords: extractFrequentTerms(anchorRaw, 6).map(t => t.word),
    description: `Core anchor: ${anchorFilename}`,
  });

  // ── scan anchor's own sections/entities ──
  const anchorResult = scanFile(INPUT_FILE, anchorNodeId, anchorFilename, anchorStat);
  allNodes.push(...anchorResult.nodes);
  allEdges.push(...anchorResult.edges);

  // ── file nodes (tier 2) + their clusters ──
  const fileResults = {};

  linkedFiles.forEach(({ path: filePath, filename }) => {
    let stat;
    try { stat = statSync(filePath); } catch { stat = null; }

    let raw;
    try { raw = readFileSync(filePath, 'utf8'); } catch {
      console.warn(`  Cannot read ${filename}, skipping.`);
      return;
    }

    const { sections } = parseMarkdown(raw);
    const h1 = sections.find(s => s.level === 1);
    const fileLabel = h1 ? h1.title : filename.replace(/\.md$/i, '');

    const fileNodeId = nid();

    // Scan file first to get result
    const result = scanFile(filePath, fileNodeId, filename, stat);
    fileResults[filename] = result;
    allNodes.push(...result.nodes);
    allEdges.push(...result.edges);

    // Calculate file node size based on connected edges (from scan results + anchor reference)
    const fileEdgeCount = (result.edges?.length || 0) + 1; // +1 for anchor→file edge
    const fileSize = Math.max(30, Math.min(80, 20 + fileEdgeCount));

    allNodes.push({
      id: fileNodeId,
      label: fileLabel,
      path: filename,
      type: 'doc',
      subtype: 'file',
      tier: 'file',
      cluster: filename,
      shared: false,
      anchor: false,
      size: fileSize,
      degree: 0,
      modified: stat ? Math.floor(stat.mtimeMs / 1000) : 0,
      keywords: extractFrequentTerms(raw, 6).map(t => t.word),
      description: `Linked file: ${filename} (${fileEdgeCount} connections)`,
    });

    // anchor → file edge
    allEdges.push({ source: anchorNodeId, target: fileNodeId, type: 'references', weight: 0.8 });

    console.log(`  Scanned ${filename}: ${result.nodes.length} nodes, ${result.edges.length} edges`);
  });

  // ── detect shared entities across files ──
  // Map normalised label → list of { cluster, id } across all files
  const labelToAppearances = {};

  const registerEntities = (entityKeys, clusterName) => {
    entityKeys.forEach(({ key, id }) => {
      if (!labelToAppearances[key]) labelToAppearances[key] = [];
      labelToAppearances[key].push({ cluster: clusterName, id });
    });
  };

  registerEntities(anchorResult.entityKeys, anchorFilename);
  Object.entries(fileResults).forEach(([filename, result]) => {
    registerEntities(result.entityKeys, filename);
  });

  const crossEdgeSet = new Set();

  Object.entries(labelToAppearances).forEach(([, appearances]) => {
    if (appearances.length < 2) return;

    // Mark nodes as shared and bump size
    appearances.forEach(({ id }) => {
      const node = allNodes.find(n => n.id === id);
      if (node) {
        node.shared = true;
        node.size = Math.min(14, node.size + 3);
        node.description += ' [shared across files]';
      }
    });

    // Cross-file edges between shared instances
    for (let i = 0; i < appearances.length; i++) {
      for (let j = i + 1; j < appearances.length; j++) {
        const a = appearances[i].id;
        const b = appearances[j].id;
        const edgeKey = [a, b].sort().join('--') + 'cross';
        if (!crossEdgeSet.has(edgeKey)) {
          crossEdgeSet.add(edgeKey);
          allEdges.push({ source: a, target: b, type: 'cross-file', weight: 0.6 });
        }
      }
    }
  });

  // ── compute degree ──
  const degree = {};
  allNodes.forEach(n => degree[n.id] = 0);
  allEdges.forEach(e => {
    degree[e.source] = (degree[e.source] || 0) + 1;
    degree[e.target] = (degree[e.target] || 0) + 1;
  });
  allNodes.forEach(n => n.degree = degree[n.id] || 0);

  // ── deduplicate edges ──
  const edgeSet = new Set();
  const cleanEdges = allEdges.filter(e => {
    const key = [e.source, e.target].sort().join('--') + e.type;
    if (edgeSet.has(key)) return false;
    edgeSet.add(key);
    return true;
  });

  // ── remove disconnected nodes ──
  const connected = new Set(cleanEdges.flatMap(e => [e.source, e.target]));
  connected.add(anchorNodeId);
  const cleanNodes = allNodes.filter(n => connected.has(n.id));

  // ── write output ──
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const graph = {
    meta: {
      project: anchorTitle,
      anchorFile: anchorFilename,
      linkedFiles: linkedFiles.map(f => f.filename),
      mode: 'multi-file-clustered',
      generated: new Date().toISOString(),
      nodeCount: cleanNodes.length,
      edgeCount: cleanEdges.length,
      fileCount: 1 + linkedFiles.length,
      sharedNodes: cleanNodes.filter(n => n.shared).length,
      generator: 'neural doc-scan v2.0.0',
    },
    nodes: cleanNodes,
    edges: cleanEdges,
  };

  // Generate timestamp for filenames
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);

  writeFileSync(join(OUTPUT_DIR, `neural_${ts}.json`), JSON.stringify(graph, null, 2));

  // ── summary ──
  const typeCounts = {};
  cleanNodes.forEach(n => typeCounts[n.tier] = (typeCounts[n.tier] || 0) + 1);

  const topNodes = [...cleanNodes]
    .filter(n => !n.anchor)
    .sort((a,b) => b.degree - a.degree)
    .slice(0, 12);

  const sharedNodes = cleanNodes.filter(n => n.shared).sort((a,b) => b.degree - a.degree);

  const summary = `# Neural — ${anchorTitle}

Anchor: \`${anchorFilename}\`
Linked files: ${linkedFiles.map(f => `\`${f.filename}\``).join(', ') || 'none'}
Generated: ${new Date().toLocaleString()}
Mode: multi-file clustered

## Stats
- **Total nodes:** ${cleanNodes.length}
- **Total connections:** ${cleanEdges.length}
- **Files scanned:** ${1 + linkedFiles.length}
- **Shared nodes (cross-file):** ${sharedNodes.length}

## Node tiers
${Object.entries(typeCounts).map(([t,c]) => `- ${t}: ${c}`).join('\n')}

## Most connected concepts
${topNodes.map((n,i) => `${i+1}. **${n.label}** (${n.tier}, cluster: ${n.cluster}) — ${n.degree} connections`).join('\n')}

## Cross-file shared concepts
${sharedNodes.slice(0,10).map((n,i) => `${i+1}. **${n.label}** — ${n.degree} connections`).join('\n') || 'None detected'}

## Layout hints for visualiser
- Group nodes by \`cluster\` field → one galaxy per .md file
- \`shared: true\` nodes bridge clusters → float them between file nodes
- \`tier\` sizes: anchor (30) > file (18) > section (2-12) > entity (1-8) > term (1-6)
- Edge type \`cross-file\` = bridge between clusters
- Edge type \`references\` = anchor → file node
- Edge type \`contains\` = file/section → child section
- Edge type \`mention\` = section/file → entity/term
- Edge type \`similarity\` = co-occurrence within same file
`;

  writeFileSync(join(OUTPUT_DIR, `summary_${ts}.md`), summary);

  console.log(`\nAnchor: ${anchorTitle}`);
  console.log(`Files scanned: ${1 + Object.keys(fileResults).length}`);
  console.log(`Nodes: ${cleanNodes.length} | Edges: ${cleanEdges.length}`);
  console.log(`Shared cross-file nodes: ${sharedNodes.length}`);
  console.log(`\nTop concepts:`);
  topNodes.slice(0,6).forEach(n => console.log(`  ${n.label} (${n.tier}, ${n.degree} conn)`));
  if (sharedNodes.length) {
    console.log(`\nShared (cross-file):`);
    sharedNodes.slice(0,5).forEach(n => console.log(`  ${n.label} (${n.degree} conn)`));
  }
  console.log(`\nOutput: ${OUTPUT_DIR}/neural_${ts}.json`);
}

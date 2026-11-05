import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from './policy.mjs';

function collectSourceFiles(dir, prefix = 'src') {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = `${prefix}/${entry.name}`;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(full, rel));
    } else if (entry.isFile() && /\.(mjs|cjs)$/.test(entry.name)) {
      files.push(rel);
    }
  }
  return files;
}

export function buildInfo(root = ROOT) {
  const files = collectSourceFiles(path.join(root, 'src')).sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file + '\0').update(fs.readFileSync(path.join(root, file)));
  }
  return { runtimeFingerprint: hash.digest('hex') };
}

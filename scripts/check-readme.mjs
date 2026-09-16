import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readmePath = resolve(root, 'README.md');
const markdown = readFileSync(readmePath, 'utf8');
const missing = [];
const unsafeProductImages = [];

for (const match of markdown.matchAll(/(!?)\[[^\]]*\]\(([^)]+)\)/g)) {
  const isImage = match[1] === '!';
  const raw = match[2].trim().replace(/^<|>$/g, '');
  if (/^(?:https?:|mailto:|#)/i.test(raw)) continue;
  const pathPart = decodeURIComponent(raw.split('#', 1)[0]);
  const target = resolve(root, pathPart);
  if (!existsSync(target)) missing.push(raw);
  if (isImage && (!pathPart.startsWith('docs/images/workbench/') || /prototype|design-recovery/i.test(pathPart))) {
    unsafeProductImages.push(raw);
  }
}

if (missing.length || unsafeProductImages.length) {
  if (missing.length) console.error(`Missing README targets:\n${missing.map((item) => `- ${item}`).join('\n')}`);
  if (unsafeProductImages.length) console.error(`Non-production README images:\n${unsafeProductImages.map((item) => `- ${item}`).join('\n')}`);
  process.exit(1);
}

console.log('README links and production image paths are valid.');

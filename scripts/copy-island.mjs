import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const src = join(process.cwd(), 'src', 'island', 'index.html');
const destDir = join(process.cwd(), 'out', 'island');
const dest = join(destDir, 'index.html');
mkdirSync(destDir, { recursive: true });
if (existsSync(src)) {
  copyFileSync(src, dest);
  console.log(`[copy-island] ${src} -> ${dest}`);
} else {
  console.error(`[copy-island] missing ${src}`);
  process.exit(1);
}
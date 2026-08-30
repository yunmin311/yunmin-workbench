import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/**
 * Portable Personal Overlay fixture.
 *
 * The Workbench treats a real Personal Overlay as external Source of Truth and
 * never writes into it, so tests must not depend on a drive-specific absolute
 * path (a `D:\\ai-governance-system` style hardcode silently turns every E2E
 * spec into a skip on any other machine).
 *
 * `tests/fixtures/overlay` holds the machine-independent part of that tree.
 * `materializeOverlayFixture()` copies it into a temp dir and then writes the
 * one file that legitimately contains absolute paths — the machine profile,
 * whose `paths.governance_repo` must equal the overlay root and whose
 * `project_roots` must point at real directories for Packet dependencies to
 * resolve. Callers hand the result to the app through the official
 * `GOV_OVERLAY` env seam, so the production discovery path is what gets tested.
 */

export const FIXTURE_PROJECT_ID = 'creative-os';
export const FIXTURE_PROJECT_DISPLAY_NAME = 'Creative OS';
/** Relative to the machine-bound project root, matching the adapter's canonical_source.path. */
export const FIXTURE_CANONICAL_PATH = 'CLAUDE.md';
export const FIXTURE_PROJECT_IDS: readonly string[] = ['creative-os', 'governance', 'personal-site'];

function locateFixtureDir(): string {
  let dir = resolve(process.cwd());
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, 'tests', 'fixtures', 'overlay');
    if (existsSync(join(candidate, 'overlay.yaml'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('overlay fixture not found: expected tests/fixtures/overlay/overlay.yaml under the repo root');
}

/** Single-quoted YAML scalars keep Windows backslashes literal. */
function machineProfileYaml(overlayRoot: string, projectRoots: Record<string, string>): string {
  const roots = FIXTURE_PROJECT_IDS
    .map((id) => `  - id: ${id}\n    local_path: '${projectRoots[id]}'`)
    .join('\n');
  return [
    'schema_version: 2',
    'profile_type: machine',
    'device_id: fixture-machine',
    'display_name: Fixture Machine',
    'available_tools:',
    "  codex: 'fixture machine does not ship a codex binary'",
    'project_roots:',
    roots,
    'paths:',
    `  governance_repo: '${overlayRoot}'`,
    '',
  ].join('\n');
}

export interface OverlayFixture {
  /** Directory handed to `discoverOverlayRoot()`; contains exactly one overlay. */
  searchRoot: string;
  /** Absolute overlay root — pass it to the app through `GOV_OVERLAY`. */
  overlayRoot: string;
  /** Machine-bound project root for `FIXTURE_PROJECT_ID`. */
  projectRoot: string;
  /** Canonical project file resolved through machine `project_roots`. */
  projectCanonicalPath: string;
}

export function materializeOverlayFixture(): OverlayFixture {
  const searchRoot = mkdtempSync(join(tmpdir(), 'wb-overlay-'));
  const overlayRoot = join(searchRoot, 'overlay');
  cpSync(locateFixtureDir(), overlayRoot, { recursive: true });

  // Project roots are the user's project repos, not part of the governance
  // overlay — on a real machine they sit next to it, so materialize them as a
  // sibling. They must be real directories: Packet dependencies only resolve
  // through machine `project_roots`, and unresolved means fail closed.
  const projectRootsDir = join(searchRoot, 'project-roots');
  cpSync(join(overlayRoot, 'project-roots'), projectRootsDir, { recursive: true });
  rmSync(join(overlayRoot, 'project-roots'), { recursive: true, force: true });

  const projectRoots: Record<string, string> = {};
  for (const id of FIXTURE_PROJECT_IDS) {
    projectRoots[id] = join(searchRoot, 'project-roots', id);
  }

  const machineDir = join(overlayRoot, 'profiles', 'machines', 'instances');
  mkdirSync(machineDir, { recursive: true });
  writeFileSync(
    join(machineDir, 'fixture-machine.yaml'),
    machineProfileYaml(overlayRoot, projectRoots),
    'utf8',
  );

  return {
    searchRoot,
    overlayRoot,
    projectRoot: projectRoots[FIXTURE_PROJECT_ID],
    projectCanonicalPath: join(projectRoots[FIXTURE_PROJECT_ID], FIXTURE_CANONICAL_PATH),
  };
}

/**
 * Prefer a real Overlay supplied through the `GOV_OVERLAY` env seam; fall back
 * to the portable fixture so the same assertions always run somewhere.
 */
export function resolveOverlayTarget(): { root: string; searchRoot: string; fromEnv: boolean } {
  const envRoot = process.env.GOV_OVERLAY;
  if (envRoot) return { root: envRoot, searchRoot: dirname(envRoot), fromEnv: true };
  const fixture = materializeOverlayFixture();
  return { root: fixture.overlayRoot, searchRoot: fixture.searchRoot, fromEnv: false };
}

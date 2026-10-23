import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const MAX_BUFFER_BYTES = 64 * 1024 * 1024;

// `node_modules/<pkg>` for a project, looking in parent directories too so a
// hoisted workspace install is found.
function findInstalledPackage(root, pkg) {
  let dir = path.resolve(root);
  for (;;) {
    const candidate = path.join(dir, 'node_modules', pkg);
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

function binEntry(packageDir, binName) {
  const { bin } = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
  const relative = typeof bin === 'string' ? bin : bin?.[binName];
  return relative ? path.resolve(packageDir, relative) : null;
}

/**
 * Run an installed package's CLI as `node <entry>`, with no shell.
 *
 * The audit wrappers used to start `npx.cmd`. Current Node refuses to spawn a
 * `.cmd` file without a shell (EINVAL), and the wrappers then wrote an empty
 * report and exited 0, so a scan that never ran read as a clean one
 * (meta-bugs #341, #349). `ok` is true only when the CLI ran and exited 0;
 * otherwise `error` says why.
 *
 * @returns {{ ok: boolean, status: number|null, stdout: string, stderr: string, error?: string }}
 */
export function runInstalledBin({ root, pkg, bin = pkg, args = [] }) {
  const packageDir = findInstalledPackage(root, pkg);
  const entry = packageDir && binEntry(packageDir, bin);
  if (!entry) {
    return { ok: false, status: null, stdout: '', stderr: '', error: `${pkg} is not installed (no node_modules/${pkg} from ${root}); run npm install` };
  }

  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    maxBuffer: MAX_BUFFER_BYTES
  });
  const outcome = { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };

  if (result.error) {
    return { ok: false, ...outcome, error: `${pkg} could not be started: ${result.error.message}` };
  }
  if (result.status !== 0) {
    const how = result.status === null ? `was stopped by ${result.signal}` : `exited with status ${result.status}`;
    return { ok: false, ...outcome, error: `${pkg} ${how}` };
  }
  return { ok: true, ...outcome };
}

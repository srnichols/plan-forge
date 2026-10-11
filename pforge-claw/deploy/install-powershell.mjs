import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const ARCHITECTURES = Object.freeze({ amd64: "x64", arm64: "arm64" });
const MAX_MANIFEST_BYTES = 65_536;
const MAX_ARCHIVE_BYTES = 134_217_728;
const EXECUTABLE_MODE = 0o755;
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/i;

class PowerShellInstallError extends Error {
  constructor(code, options) {
    super(code, options);
    this.name = "PowerShellInstallError";
    this.code = code;
  }
}

function validateOptions({ version, architecture, directory, temporaryRoot }) {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new PowerShellInstallError("PWSH_VERSION_INVALID");
  }
  if (!Object.hasOwn(ARCHITECTURES, architecture)) throw new PowerShellInstallError("PWSH_ARCH_UNSUPPORTED");
  if (typeof directory !== "string" || !path.isAbsolute(directory) || !path.isAbsolute(temporaryRoot)) {
    throw new PowerShellInstallError("PWSH_DIRECTORY_INVALID");
  }
}

async function fetchResponse(url, fetchFn) {
  const response = await fetchFn(url);
  if (!response.ok || !response.body) throw new PowerShellInstallError("PWSH_DOWNLOAD_FAILED");
  return response;
}

async function releaseChecksum(response, archiveName) {
  const manifest = await response.text();
  if (Buffer.byteLength(manifest) > MAX_MANIFEST_BYTES) throw new PowerShellInstallError("PWSH_MANIFEST_INVALID");
  const matches = manifest.split(/\r?\n/).map((line) => line.trim().split(/\s+/, 2))
    .filter(([, filename]) => filename?.replace(/^\*/, "") === archiveName);
  if (matches.length !== 1 || !CHECKSUM_PATTERN.test(matches[0][0])) {
    throw new PowerShellInstallError("PWSH_MANIFEST_INVALID");
  }
  return matches[0][0].toLowerCase();
}

async function downloadArchive(response, archive) {
  const hash = createHash("sha256");
  let bytes = 0;
  const bounded = new Transform({
    transform(chunk, encoding, next) {
      bytes += chunk.length;
      if (bytes > MAX_ARCHIVE_BYTES) return next(new PowerShellInstallError("PWSH_ARCHIVE_TOO_LARGE"));
      hash.update(chunk);
      next(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), bounded, createWriteStream(archive, { flags: "wx" }));
  return hash.digest("hex");
}

function extractVerifiedArchive(archive, directory) {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", ["-xzf", archive, "-C", directory], { shell: false, stdio: "inherit" });
    child.once("error", (cause) => reject(new PowerShellInstallError("PWSH_EXTRACT_FAILED", { cause })));
    child.once("close", (code) => code === 0 ? resolve()
      : reject(new PowerShellInstallError("PWSH_EXTRACT_FAILED")));
  });
}

/**
 * @param {{version:string, architecture:string, directory:string, temporaryRoot?:string,
 * fetchFn?:typeof fetch, extractArchive?:(archive:string, directory:string)=>Promise<void>}} options
 * @returns {Promise<void>}
 */
export async function installPowerShell({
  version, architecture, directory, temporaryRoot = os.tmpdir(),
  fetchFn = fetch, extractArchive = extractVerifiedArchive,
}) {
  validateOptions({ version, architecture, directory, temporaryRoot });
  const archiveName = `powershell-${version}-linux-${ARCHITECTURES[architecture]}.tar.gz`;
  const release = `https://github.com/PowerShell/PowerShell/releases/download/v${version}`;
  await mkdir(temporaryRoot, { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(temporaryRoot, "pforge-pwsh-"));
  try {
    const checksum = await releaseChecksum(await fetchResponse(`${release}/hashes.sha256`, fetchFn), archiveName);
    const archive = path.join(temporaryDirectory, archiveName);
    const measured = await downloadArchive(await fetchResponse(`${release}/${archiveName}`, fetchFn), archive);
    if (measured !== checksum) throw new PowerShellInstallError("PWSH_CHECKSUM_MISMATCH");
    await mkdir(directory, { recursive: true });
    await extractArchive(archive, directory);
    await chmod(path.join(directory, "pwsh"), EXECUTABLE_MODE);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await installPowerShell({
      version: process.argv[2], architecture: process.argv[3], directory: process.argv[4],
    });
  } catch (error) {
    console.error(error instanceof PowerShellInstallError ? error.code : "PWSH_INSTALL_FAILED");
    process.exitCode = 1;
  }
}

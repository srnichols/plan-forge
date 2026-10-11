import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VERSION = "7.4.6";
const ARCHIVE = Buffer.from("fixed fixture archive bytes");
const CHECKSUM = createHash("sha256").update(ARCHIVE).digest("hex");
const directories = [];

async function fixture({ architecture = "amd64", checksum = CHECKSUM, status = 200 } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "claw-pwsh-install-"));
  directories.push(root);
  const directory = path.join(root, "runtime");
  const temporaryRoot = path.join(root, "temporary");
  const archiveName = `powershell-${VERSION}-linux-${architecture === "amd64" ? "x64" : "arm64"}.tar.gz`;
  const downloads = [];
  const extractions = [];
  return {
    root, directory, temporaryRoot, downloads, extractions,
    options: {
      version: VERSION, architecture, directory, temporaryRoot,
      async fetchFn(url) {
        downloads.push(url);
        if (status !== 200) return new Response("unavailable", { status });
        return url.endsWith("hashes.sha256")
          ? new Response(`${checksum} *${archiveName}\n`)
          : new Response(ARCHIVE);
      },
      async extractArchive(archive, destination) {
        extractions.push({ archive, destination });
        expect(await readFile(archive)).toEqual(ARCHIVE);
        await writeFile(path.join(destination, "pwsh"), "fixed fixture executable\n");
      },
    },
  };
}

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("portable PowerShell image provisioning", () => {
  it.each(["amd64", "arm64"])("verifies the official binary-mode checksum before extracting %s", async (architecture) => {
    const { installPowerShell } = await import("../deploy/install-powershell.mjs");
    const provision = await fixture({ architecture });
    await installPowerShell(provision.options);
    const runtimeArchitecture = architecture === "amd64" ? "x64" : "arm64";
    const release = `https://github.com/PowerShell/PowerShell/releases/download/v${VERSION}`;
    expect(provision.downloads).toEqual([
      `${release}/hashes.sha256`,
      `${release}/powershell-${VERSION}-linux-${runtimeArchitecture}.tar.gz`,
    ]);
    expect(provision.extractions).toHaveLength(1);
    expect(provision.extractions[0].destination).toBe(provision.directory);
    expect(await readFile(path.join(provision.directory, "pwsh"), "utf8")).toBe("fixed fixture executable\n");
    expect(await readdir(provision.temporaryRoot)).toEqual([]);
  });

  it("rejects a mismatched archive before any extraction and removes its own temporary files", async () => {
    const { installPowerShell } = await import("../deploy/install-powershell.mjs");
    const provision = await fixture({ checksum: "0".repeat(64) });
    await expect(installPowerShell(provision.options)).rejects.toMatchObject({ code: "PWSH_CHECKSUM_MISMATCH" });
    expect(provision.extractions).toEqual([]);
    expect(await readdir(provision.temporaryRoot)).toEqual([]);
  });

  it("rejects failed public downloads without installing a partial runtime", async () => {
    const { installPowerShell } = await import("../deploy/install-powershell.mjs");
    const provision = await fixture({ status: 503 });
    await expect(installPowerShell(provision.options)).rejects.toMatchObject({ code: "PWSH_DOWNLOAD_FAILED" });
    expect(provision.downloads).toHaveLength(1);
    expect(provision.extractions).toEqual([]);
  });

  it.each([
    { version: "../untrusted", code: "PWSH_VERSION_INVALID" },
    { architecture: "unsupported", code: "PWSH_ARCH_UNSUPPORTED" },
    { directory: "relative-runtime", code: "PWSH_DIRECTORY_INVALID" },
  ])("validates provisioning choices before download: $code", async ({ code, ...override }) => {
    const { installPowerShell } = await import("../deploy/install-powershell.mjs");
    const provision = await fixture();
    await expect(installPowerShell({ ...provision.options, ...override })).rejects.toMatchObject({ code });
    expect(provision.downloads).toEqual([]);
    expect(provision.extractions).toEqual([]);
  });
});

describe("Guard: container workers install the same verified native runtime", () => {
  it.each(["Dockerfile.worker-base", "Dockerfile.k8s-fixtures"])("provisions and probes native ownership dependencies in %s", async (file) => {
    const source = await readFile(path.join(PACKAGE_ROOT, "deploy", file), "utf8");
    expect(source).toContain(`ARG PWSH_VERSION=${VERSION}`);
    expect(source).toContain("ARG TARGETARCH");
    expect(source).toContain("install-powershell.mjs");
    expect(source).toContain('"$PWSH_VERSION" "$TARGETARCH"');
    expect(source).toMatch(/\bpwsh\s+-v\b/);
    expect(source).toMatch(/USER\s+10001:10001/);
    expect(source).not.toMatch(/--privileged|CAP_SYS_ADMIN|SYS_PTRACE|seccomp=unconfined/);
  });
});

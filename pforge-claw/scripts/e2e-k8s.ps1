param()

$ErrorActionPreference = "Stop"
$packageRoot = Split-Path -Parent $PSScriptRoot
$kind = Get-Command kind -ErrorAction SilentlyContinue
$k3d = Get-Command k3d -ErrorAction SilentlyContinue
$kubectl = Get-Command kubectl -ErrorAction SilentlyContinue

if (-not $kubectl) {
    [Console]::Out.WriteLine("SKIPPED: kubectl is not installed.")
    exit 0
}
if (-not $kind -and -not $k3d) {
    [Console]::Out.WriteLine("SKIPPED: neither kind nor k3d is installed.")
    exit 0
}
& kubectl cluster-info *> $null
if ($LASTEXITCODE -ne 0) {
    [Console]::Out.WriteLine("SKIPPED: no reachable Kubernetes cluster.")
    exit 0
}

$namespace = "pforge-claw-e2e-$([guid]::NewGuid().ToString('N').Substring(0, 12))"
$images = @(
    "pforge-claw-dev/local/pforge-claw-dispatcher:dev",
    "pforge-claw-dev/local/pforge-claw-worker-node:dev"
)
$status = 0
try {
    $buildArgs = @(
        "-Registry", "pforge-claw-dev",
        "-Namespace", "local",
        "-Tag", "dev",
        "-Variants", "node",
        "-Platforms", "linux/amd64",
        "-Load"
    )
    & (Join-Path $PSScriptRoot "build-images.ps1") @buildArgs
    if ($LASTEXITCODE -ne 0) { throw "build-images failed with exit code $LASTEXITCODE" }
    $dockerArgs = @(
        "build", "--file", (Join-Path $packageRoot "deploy/Dockerfile.dispatcher"),
        "--tag", $images[0], $packageRoot
    )
    & docker @dockerArgs
    if ($LASTEXITCODE -ne 0) { throw "dispatcher image build failed with exit code $LASTEXITCODE" }

    if ($kind) {
        foreach ($image in $images) {
            $invokeArgs = @("load", "docker-image", $image)
            & kind @invokeArgs
            if ($LASTEXITCODE -ne 0) { throw "kind image load failed with exit code $LASTEXITCODE" }
        }
    } else {
        foreach ($image in $images) {
            $invokeArgs = @("image", "import", $image)
            & k3d @invokeArgs
            if ($LASTEXITCODE -ne 0) { throw "k3d image import failed with exit code $LASTEXITCODE" }
        }
    }

    $invokeArgs = @("create", "namespace", $namespace)
    & kubectl @invokeArgs
    if ($LASTEXITCODE -ne 0) { throw "namespace creation failed with exit code $LASTEXITCODE" }
    $invokeArgs = @("apply", "-k", (Join-Path $packageRoot "deploy/k8s/overlays/dev"), "-n", $namespace)
    & kubectl @invokeArgs
    if ($LASTEXITCODE -ne 0) { throw "dev overlay apply failed with exit code $LASTEXITCODE" }
    $invokeArgs = @("wait", "--for=condition=complete", "job/pforge-claw-egress-probe", "-n", $namespace, "--timeout=90s")
    & kubectl @invokeArgs
    if ($LASTEXITCODE -ne 0) { throw "egress denial probe did not pass" }
    $e2eArgs = @("run", "test:e2e", "--", "--run", "tests/e2e/away-from-desk.test.mjs")
    & npm --prefix $packageRoot @e2eArgs
    if ($LASTEXITCODE -ne 0) { throw "K8sJobLane scenario (a) failed with exit code $LASTEXITCODE" }
    $invokeArgs = @("wait", "--for=delete", "job/pforge-claw-egress-probe", "-n", $namespace, "--timeout=45s")
    & kubectl @invokeArgs
    if ($LASTEXITCODE -ne 0) { throw "egress probe Job was not removed after its TTL" }
} catch {
    [Console]::Error.WriteLine("e2e-k8s: $($_.Exception.Message)")
    $status = 1
} finally {
    $invokeArgs = @("delete", "namespace", $namespace, "--ignore-not-found=true", "--wait=true")
    & kubectl @invokeArgs *> $null
    if ($LASTEXITCODE -ne 0 -and $status -eq 0) { $status = $LASTEXITCODE }
}
exit $status

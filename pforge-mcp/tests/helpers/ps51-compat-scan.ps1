# Lists what Windows PowerShell 5.1 cannot run in the PowerShell files named in -List (one path per line).
# Prints "path|line|rule|text" for each finding, and nothing when the files are clean. Run it with PowerShell 7:
# it looks for syntax and parameters that only exist there. Used by scripts-windows-powershell.test.mjs.
param([Parameter(Mandatory)][string]$List)

$lang = 'System.Management.Automation.Language'
$sevenOnlyNodes = 'TernaryExpressionAst', 'PipelineChainAst', 'NullConditionalMemberAccessAst', 'NullConditionalIndexExpressionAst'
$sevenOnlyParameters = 'Parallel', 'AsHashtable', 'AsByteStream', 'SkipCertificateCheck', 'AdditionalChildPath'

function Write-Finding($path, $node, $rule) {
    $text = ($node.Extent.Text -replace '\s+', ' ')
    if ($text.Length -gt 80) { $text = $text.Substring(0, 80) }
    '{0}|{1}|{2}|{3}' -f $path, $node.Extent.StartLineNumber, $rule, $text
}

foreach ($path in Get-Content -LiteralPath $List -Encoding UTF8) {
    if (-not $path) { continue }
    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)

    # A script that declares it needs PowerShell 7 is not held to 5.1.
    $required = $ast.ScriptRequirements.RequiredPSVersion
    if ($required -and $required.Major -ge 7) { continue }

    foreach ($node in $ast.FindAll({ $true }, $true)) {
        $typeName = $node.GetType().Name
        if ($sevenOnlyNodes -contains $typeName) { Write-Finding $path $node 'powershell-7-syntax'; continue }
        if ($typeName -eq 'BinaryExpressionAst' -and "$($node.Operator)" -eq 'QuestionQuestion') { Write-Finding $path $node 'powershell-7-syntax'; continue }
        if ($typeName -eq 'AssignmentStatementAst' -and "$($node.Operator)" -eq 'QuestionQuestionEquals') { Write-Finding $path $node 'powershell-7-syntax'; continue }
        if ($typeName -ne 'CommandAst') { continue }

        $command = $node.GetCommandName()
        $elements = @($node.CommandElements | Select-Object -Skip 1)
        $parameters = @($elements | Where-Object { $_.GetType().Name -eq 'CommandParameterAst' })
        if (@($parameters | Where-Object { $sevenOnlyParameters -contains $_.ParameterName }).Count -gt 0) { Write-Finding $path $node 'powershell-7-parameter' }

        if ($command -eq 'Join-Path') {
            # Path and ChildPath: a third positional argument is PowerShell 6+ (AdditionalChildPath).
            $positional = 0
            $expectsValue = $false
            foreach ($element in $elements) {
                if ($element.GetType().Name -eq 'CommandParameterAst') { $expectsValue = (-not $element.Argument) -and $element.ParameterName -ne 'Resolve'; continue }
                if ($expectsValue) { $expectsValue = $false; continue }
                $positional++
            }
            if ($positional -gt 2) { Write-Finding $path $node 'join-path-three-arguments' }
        }

        if ($command -eq 'Invoke-WebRequest' -or $command -eq 'iwr') {
            # Without it Windows PowerShell 5.1 parses the response with the Internet Explorer engine.
            if (@($parameters | Where-Object { $_.ParameterName -like 'UseBasic*' }).Count -eq 0) { Write-Finding $path $node 'invoke-webrequest-without-basic-parsing' }
        }
    }
}

# 构建并把插件部署到本机 Tabby，用于开发调试。
# 用法（项目根目录，PowerShell）：
#   .\use-in-tabby.ps1              # 构建 + 目录联接（推荐，改完重建即生效，需重启 Tabby）
#   .\use-in-tabby.ps1 -NoBuild     # 不构建，仅部署
#   .\use-in-tabby.ps1 -Mode Copy   # 拷贝模式（不建联接）
#   .\use-in-tabby.ps1 -RestartTabby  # 部署后自动重启 Tabby
[CmdletBinding()]
param(
    [switch]$NoBuild,
    [ValidateSet('Link', 'Copy')]
    [string]$Mode = 'Link',
    [switch]$RestartTabby
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = $PSScriptRoot
$PackageName = 'tabby-smart-upload'
$PluginsRoot = Join-Path $env:APPDATA 'tabby\plugins\node_modules'
$TargetDir = Join-Path $PluginsRoot $PackageName

if (-not $NoBuild) {
    Write-Host "==> 构建插件 ..." -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "构建失败" }
}

if (-not (Test-Path $PluginsRoot)) {
    New-Item -ItemType Directory -Path $PluginsRoot -Force | Out-Null
}

if (Test-Path $TargetDir) {
    Write-Host "==> 已存在旧部署，移除：$TargetDir" -ForegroundColor Yellow
    # 联接/目录都 Remove-Item 即可（联接只删链接不删源）
    Remove-Item -Recurse -Force $TargetDir
}

if ($Mode -eq 'Link') {
    Write-Host "==> 创建目录联接到项目根：$TargetDir" -ForegroundColor Cyan
    cmd /c mklink /J "$TargetDir" "$ProjectRoot" | Out-Null
} else {
    Write-Host "==> 拷贝 dist 与 package.json：$TargetDir" -ForegroundColor Cyan
    New-Item -ItemType Directory -Path $TargetDir | Out-Null
    Copy-Item (Join-Path $ProjectRoot 'package.json') $TargetDir
    Copy-Item -Recurse (Join-Path $ProjectRoot 'dist') $TargetDir
}

Write-Host "==> 部署完成：$TargetDir" -ForegroundColor Green

if ($RestartTabby) {
    Write-Host "==> 重启 Tabby ..." -ForegroundColor Cyan
    Get-Process -Name 'Tabby' -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
    $Exe = Join-Path $env:LOCALAPPDATA 'Programs\Tabby\Tabby.exe'
    if (Test-Path $Exe) { Start-Process $Exe } else { Write-Host "未找到 $Exe，请手动启动 Tabby" -ForegroundColor Yellow }
}

Write-Host ""
Write-Host "验证方式：Tabby → 设置 → 插件，应出现 Smart Upload；" -ForegroundColor Green
Write-Host "打开 DevTools（帮助 → Toggle Developer Tools）Console 应看到 [smart-upload] module loaded" -ForegroundColor Green

Write-Host "无头自动验证（可选）：Tabby.exe --remote-debugging-port=9223 启动后，执行" -ForegroundColor Green
Write-Host "  & C:\\nvm4w\\nodejs\\node.exe scripts\\cdp-check.mjs  (UPLOAD_ICON_IN_DOM: true 即加载成功)" -ForegroundColor Green

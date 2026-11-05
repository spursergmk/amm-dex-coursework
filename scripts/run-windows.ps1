# 一键复现：本地链 -> 部署 -> 20 用户模拟 -> 截图与录像 -> 核查 -> 报告 -> 打包
# 用法：在 amm-dex 目录下执行  pwsh -ExecutionPolicy Bypass -File scripts\run-windows.ps1
# 中途想跳过某一步：-SkipSimulate / -SkipDemo / -SkipBrowser / -SkipReport / -SkipPackage
param(
  [switch]$SkipSimulate,
  [switch]$SkipDemo,
  [switch]$SkipBrowser,
  [switch]$SkipVerify,
  [switch]$SkipReport,
  [switch]$SkipPackage
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($text) { Write-Host "`n===== $text =====" -ForegroundColor Cyan }
function Wait-Http($url, $seconds = 90, [scriptblock]$probe = $null) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      if ($probe) { & $probe | Out-Null } else { Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 | Out-Null }
      return
    } catch { Start-Sleep -Milliseconds 500 }
  }
  throw "等待超时：$url"
}

$node = (Get-Command node).Source
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { $npm = (Get-Command npm).Source }
Write-Host "node: $(& $node --version)  ($node)"

Step '检查依赖'
if (-not (Test-Path 'contracts\node_modules')) { & $npm ci --prefix contracts --no-audit --no-fund }
if (-not (Test-Path 'web\node_modules')) { & $npm ci --prefix web --no-audit --no-fund }

Step '启动本地链 (127.0.0.1:8545)'
$chainLog = Join-Path $env:TEMP 'amm-dex-chain.log'
$chain = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "`"$npm`" run node" `
  -WorkingDirectory (Join-Path $root 'contracts') -RedirectStandardOutput $chainLog -RedirectStandardError "$chainLog.err" -PassThru
Write-Host "链进程 PID $($chain.Id)，日志 $chainLog"
Wait-Http 'http://127.0.0.1:8545' 90 { Invoke-RestMethod -Uri 'http://127.0.0.1:8545' -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' }

try {
  Step '部署合约'
  Push-Location contracts; & $npm run deploy; Pop-Location

  if (-not $SkipSimulate) {
    Step '20 用户随机模拟 + 套利 + 失败回滚'
    Push-Location contracts; & $npm run simulate; Pop-Location
  }

  Step '启动前端 (127.0.0.1:5173)'
  $webLog = Join-Path $env:TEMP 'amm-dex-web.log'
  $web = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "`"$npm`" run dev" -WorkingDirectory (Join-Path $root 'web') `
    -RedirectStandardOutput $webLog -RedirectStandardError "$webLog.err" -PassThru
  Write-Host "前端进程 PID $($web.Id)，日志 $webLog"
  Wait-Http 'http://127.0.0.1:5173' 90

  try {
    Step '安装 Playwright Chromium'
    Push-Location web; & npx.cmd playwright install chromium; Pop-Location

    if (-not $SkipDemo) {
      Step '录制演示视频 (docs/video/amm-dex-demo.webm)'
      Push-Location web; & $node 'tests/demo.mjs'; Pop-Location
    }
    if (-not $SkipBrowser) {
      Step '浏览器流程测试 + 截图'
      Push-Location web; & $node 'tests/browser.mjs'; Pop-Location
    }
    if (-not $SkipVerify) {
      Step '最终链上核查'
      Push-Location contracts; & $npm run verify; Pop-Location
    }
    if (-not $SkipReport) {
      Step '重新生成实验报告 PDF'
      Push-Location web; & $node 'scripts/report.mjs'; Pop-Location
    }
    if (-not $SkipPackage) {
      Step '打包提交 zip'
      $py = $null
      foreach ($candidate in @('python', 'py', 'python3')) {
        $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($cmd) { try { & $cmd.Source --version 2>&1 | Out-Null; if ($LASTEXITCODE -eq 0) { $py = $cmd.Source; break } } catch { } }
      }
      if ($py) { & $py 'scripts/package.py' }
      else { Write-Warning '未找到可用的 Python，跳过打包；可手动执行 python scripts/package.py' }
    }
    Step '全部完成'
  } finally {
    Stop-Process -Id $web.Id -Force -ErrorAction SilentlyContinue
  }
} finally {
  Stop-Process -Id $chain.Id -Force -ErrorAction SilentlyContinue
}

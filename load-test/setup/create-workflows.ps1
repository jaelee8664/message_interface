# ─────────────────────────────────────────────────────────────────
# 부하테스트용 워크플로우 등록 스크립트 (PowerShell)
#
# 사용법:
#   .\setup\create-workflows.ps1
#   .\setup\create-workflows.ps1 -BaseUrl http://192.168.1.10:8080
#   .\setup\create-workflows.ps1 -Password mypass
#
# 실행 정책 오류 시:
#   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
# ─────────────────────────────────────────────────────────────────

param(
    [string]$BaseUrl  = "http://localhost:8080",
    [string]$Password = "admin"
)

# UTF-8 콘솔 출력 강제 (한글 깨짐 방지)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8

$ScriptDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$WorkflowsDir = Join-Path $ScriptDir "workflows"

Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "  부하테스트 워크플로우 등록"
Write-Host "  서버: $BaseUrl"
Write-Host "===================================================" -ForegroundColor Cyan

# ── 서버 연결 확인 (실패해도 진행 여부 선택) ─────────────────────
Write-Host ""
Write-Host "[0/3] 서버 연결 확인..." -ForegroundColor Yellow
try {
    $null = Invoke-RestMethod -Uri "$BaseUrl/synapse/workflow/units" -Method Get -TimeoutSec 5
    Write-Host "  v 서버 연결 확인 완료" -ForegroundColor Green
} catch {
    Write-Host "  x 서버에 연결할 수 없습니다: $BaseUrl" -ForegroundColor Red
    Write-Host "    message-interface 서버를 먼저 실행해주세요." -ForegroundColor Red
    exit 1
}

# ── 워크플로우 등록 함수 ──────────────────────────────────────────
function Register-Workflow {
    param(
        [string]$Step,
        [string]$FilePath,
        [string]$DisplayName
    )

    Write-Host ""
    Write-Host "[$Step] $DisplayName 등록 중..." -ForegroundColor Yellow

    # JSON 읽기 (UTF-8) + password 치환
    $json = [System.IO.File]::ReadAllText($FilePath, [System.Text.Encoding]::UTF8)
    $json = $json -replace '"admin"', "`"$Password`""
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($json)

    try {
        $response = Invoke-RestMethod `
            -Uri "$BaseUrl/synapse/workflow/units" `
            -Method Post `
            -ContentType "application/json; charset=utf-8" `
            -Body $bodyBytes `
            -TimeoutSec 10

        if ($response.success -eq $true) {
            Write-Host "  v 등록 완료" -ForegroundColor Green
        } else {
            Write-Host "  x 등록 실패: $($response.message)" -ForegroundColor Red
            Write-Host "    이미 등록된 워크플로우라면 delete-workflows.ps1 를 먼저 실행하세요." -ForegroundColor Yellow
        }
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.Value__
        $errBody    = $_.ErrorDetails.Message

        if ($statusCode -eq 400 -and $errBody -match "교집합|이미") {
            Write-Host "  x 조건 충돌 — 기존 워크플로우와 겹칩니다." -ForegroundColor Red
            Write-Host "    delete-workflows.ps1 실행 후 재시도하세요." -ForegroundColor Yellow
        } elseif ($statusCode -eq 403) {
            Write-Host "  x 비밀번호 불일치 — -Password 옵션을 확인하세요." -ForegroundColor Red
        } else {
            Write-Host "  x 등록 실패 (HTTP $statusCode)" -ForegroundColor Red
            Write-Host "    응답: $errBody" -ForegroundColor DarkGray
        }
    }
}

# ── 워크플로우 등록 ───────────────────────────────────────────────
Register-Workflow "1/3" "$WorkflowsDir\lt-simple.json"    "[부하테스트] 최소 파이프라인"
Register-Workflow "2/3" "$WorkflowsDir\lt-pipeline.json"  "[부하테스트] 풀 파이프라인"
Register-Workflow "3/3" "$WorkflowsDir\lt-websocket.json" "[부하테스트] WebSocket 서버"

Write-Host ""
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "  등록된 엔드포인트:"
Write-Host "    POST $BaseUrl/load-test/simple    (최소 파이프라인)"
Write-Host "    POST $BaseUrl/load-test/pipeline  (풀 파이프라인)"
Write-Host "    WS   $BaseUrl/load-test/ws        (WebSocket)"
Write-Host ""
Write-Host "  다음 단계:"
Write-Host "    k6 run k6\01_smoke.js"
Write-Host "===================================================" -ForegroundColor Cyan

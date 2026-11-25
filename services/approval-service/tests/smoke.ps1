# End-to-end and security checks for the Approval service on Floci.
# Usage:  .\tests\smoke.ps1 -Api <approvals apiUrl> [-RequestsApi <requests apiUrl>]
#   Both URLs are read from the deploy outputs when not given. Asks for the test password and
#   Sara's 6-digit authenticator code (Managers use MFA). Nothing is saved.
param([string]$Api, [string]$RequestsApi)
$ErrorActionPreference = 'Stop'
$here = Split-Path $PSScriptRoot -Parent
if (-not $Api) { $Api = (Get-Content (Join-Path $here 'deploy\approvals-outputs.json') -Raw | ConvertFrom-Json).apiUrl }
if (-not $RequestsApi) { $RequestsApi = (Get-Content (Join-Path $here '..\leave-request-service\deploy\requests-outputs.json') -Raw | ConvertFrom-Json).apiUrl }
$Api = $Api.TrimEnd('/'); $RequestsApi = $RequestsApi.TrimEnd('/')
Write-Host "approvals-api: $Api`nrequests-api:  $RequestsApi"
$pw = if ($env:LEAVEFLOW_TEST_PASSWORD) { $env:LEAVEFLOW_TEST_PASSWORD } else { Read-Host 'Test password' }

function Call($base, $method, $path, $token, $body) {
  $h = @{}; if ($token) { $h.Authorization = "Bearer $token" }
  try {
    $p = @{ Method = $method; Uri = "$base$path"; Headers = $h; TimeoutSec = 90 }
    if ($body) { $p.ContentType = 'application/json'; $p.Body = ($body | ConvertTo-Json -Depth 5) }
    $r = Invoke-WebRequest @p -UseBasicParsing
    return @{ status = [int]$r.StatusCode; body = if ($r.Content) { $r.Content | ConvertFrom-Json } else { $null } }
  } catch {
    $resp = $_.Exception.Response
    if (-not $resp) { throw }
    $reader = New-Object IO.StreamReader($resp.GetResponseStream())
    $text = $reader.ReadToEnd()
    return @{ status = [int]$resp.StatusCode; body = $(try { $text | ConvertFrom-Json } catch { $text }) }
  }
}
$script:pass = 0; $script:fail = 0
function Check($name, $res, $expected) {
  $ok = $res.status -eq $expected
  if ($ok) { $script:pass++ } else { $script:fail++ }
  Write-Host ("[{0}] {1}: got {2}, expected {3}" -f ($(if ($ok) {'PASS'} else {'FAIL'})), $name, $res.status, $expected) -ForegroundColor $(if ($ok) {'Green'} else {'Red'})
  if (-not $ok) { $res.body | ConvertTo-Json -Depth 6 | Write-Host }
}
function Login($email) {
  $r = Call $RequestsApi POST '/auth/login' $null @{ email = $email; password = $pw }
  if ($r.body.idToken) { return $r.body.idToken }
  if ($r.body.mfaSetupRequired) { throw "$email has no authenticator yet. Sign in once at http://localhost:8080/login.html to link it, then run this again." }
  if ($r.body.mfaRequired) {
    $code = Read-Host "6-digit authenticator code for $email"
    $m = Call $RequestsApi POST '/auth/mfa' $null @{ email = $email; session = $r.body.session; code = $code }
    if ($m.body.idToken) { return $m.body.idToken }
  }
  throw "Login failed for ${email}: $($r.status) $($r.body | ConvertTo-Json -Compress)"
}

$mona = Login 'mona.employee@leaveflow.test'
$omar = Login 'omar.employee@leaveflow.test'
$sara = Login 'sara.manager@leaveflow.test'

Write-Host "`n-- Access control" -ForegroundColor Cyan
Check 'No token -> 401 (API Gateway authorizer)'   (Call $Api GET '/approvals' $null) 401
Check 'Employee opens approvals queue -> 403'      (Call $Api GET '/approvals' $mona) 403
Check 'Employee opens team calendar -> 403'        (Call $Api GET '/team-calendar' $mona) 403
Check 'Manager opens queue -> 200'                 (Call $Api GET '/approvals' $sara) 200

Write-Host "`n-- End-to-end: submit -> manager queue -> approve -> request Approved" -ForegroundColor Cyan
# A random Sunday 2-20 weeks ahead, so reruns do not overlap earlier test requests
$d = (Get-Date).AddDays(8 + 7 * (Get-Random -Minimum 1 -Maximum 20)); while ($d.DayOfWeek -ne 'Sunday') { $d = $d.AddDays(1) }
$day = $d.ToString('yyyy-MM-dd')
$sub = Call $RequestsApi POST '/leave-requests' $mona @{ type = 'Annual'; start = $day; end = $day; reason = 'Approval smoke test' }
Check "Mona submits Annual leave on $day" $sub 201
$reqId = $sub.body.id

$task = $null
for ($i = 0; $i -lt 15 -and -not $task; $i++) {
  Start-Sleep -Seconds 3
  $q = Call $Api GET '/approvals' $sara
  $task = @($q.body) | Where-Object { $_.requestId -eq $reqId } | Select-Object -First 1
}
Check 'Event reached the approval service (task in Sara''s queue)' @{ status = $(if ($task) { 200 } else { 404 }); body = 'not in queue after 45 s' } 200
if ($task) {
  Write-Host ("   coverage: {0}, team size {1}" -f $task.coverage.level, $task.coverage.teamSize)
  Check 'Employee decides the task -> 403'       (Call $Api POST "/approvals/$($task.id)/decision" $mona @{ decision = 'Approved' }) 403
  Check 'Reject without comment -> 400'          (Call $Api POST "/approvals/$($task.id)/decision" $sara @{ decision = 'Rejected' }) 400
  Check 'Unknown decision -> 400'                (Call $Api POST "/approvals/$($task.id)/decision" $sara @{ decision = 'Maybe' }) 400
  Check 'Sara approves -> 200'                   (Call $Api POST "/approvals/$($task.id)/decision" $sara @{ decision = 'Approved'; comment = 'Enjoy' }) 200
  Check 'Approve the same task twice -> 409'     (Call $Api POST "/approvals/$($task.id)/decision" $sara @{ decision = 'Approved' }) 409
  Check 'Decision in Sara''s history'            (Call $Api GET '/approvals/history' $sara) 200

  $status = $null
  for ($i = 0; $i -lt 10 -and $status -ne 'Approved'; $i++) { Start-Sleep -Seconds 3; $status = (Call $RequestsApi GET "/leave-requests/$reqId" $mona).body.status }
  Check "request.approved event updated the request (status: $status)" @{ status = $(if ($status -eq 'Approved') { 200 } else { 409 }); body = $status } 200
}

Write-Host "`n-- Notifications (ownership)" -ForegroundColor Cyan
$monaNotes = Call $Api GET '/notifications' $mona
Check 'Mona reads her inbox' $monaNotes 200
$note = @($monaNotes.body) | Select-Object -First 1
if ($note) {
  Check "Omar marks Mona's notification read -> 404" (Call $Api PATCH "/notifications/$($note.id)" $omar) 404
  Check "Omar deletes Mona's notification -> 404"    (Call $Api DELETE "/notifications/$($note.id)" $omar) 404
  Check 'Mona marks her notification read -> 200'    (Call $Api PATCH "/notifications/$($note.id)" $mona) 200
}
Check 'Not JSON -> 415' @{ status = try { (Invoke-WebRequest -Method Post -Uri "$Api/approvals/00000000-0000-0000-0000-000000000000/decision" -Headers @{Authorization="Bearer $sara"} -ContentType 'text/plain' -Body 'x' -UseBasicParsing).StatusCode } catch { [int]$_.Exception.Response.StatusCode } } 415

Write-Host ("`n{0} passed, {1} failed" -f $script:pass, $script:fail) -ForegroundColor $(if ($script:fail) {'Red'} else {'Green'})

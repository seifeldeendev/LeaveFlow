# LeaveFlow - Approval Workflow Service (owner: Ammar)
# Deploys this service onto Floci:
#   Secrets Manager secret, least-privilege IAM roles, Lambda approvals-fn, CloudWatch log group,
#   SNS topic leaveflow-notifications, Step Functions escalation timer, the shared EventBridge bus
#   leaveflow-bus with every routing rule, CloudWatch metric filters and alarms, and the approvals-api
#   HTTP API with the Cognito JWT authorizer.
# Safe to run again: existing resources are reused and the Lambda code is updated.
# Run:  powershell -ExecutionPolicy Bypass -File .\deploy\deploy.ps1
#       add -DemoMode $false for the real 48-hour escalation (default: 2 minutes for the demo)
param([bool]$DemoMode = $true)

$ErrorActionPreference = 'Stop'
$Endpoint = if ($env:AWS_ENDPOINT_URL) { $env:AWS_ENDPOINT_URL } else { 'http://localhost:4566' }
$Region   = 'us-east-1'
$env:AWS_DEFAULT_REGION = $Region
$Root     = Split-Path $PSScriptRoot -Parent
$Tmp      = Join-Path $env:TEMP 'leaveflow-approvals-deploy'
New-Item -ItemType Directory -Force $Tmp | Out-Null

# Inside Lambda containers "localhost" is the container itself; Docker Desktop reaches Floci via this name.
$InsideEndpoint = 'http://host.docker.internal:4566'
$FrontendOrigin = 'http://localhost:8080'
$FnName = 'approvals-fn'; $RoleName = 'approvals-fn-role'; $ApiName = 'approvals-api'
$SecretName = 'leaveflow/approvals'; $Bus = 'leaveflow-bus'; $TopicName = 'leaveflow-notifications'
$SmName = 'leave-approval-escalation'; $SmRoleName = 'approvals-sfn-role'

function Invoke-Aws {
    $out = & aws --endpoint-url $Endpoint --cli-read-timeout 600 @args
    if ($LASTEXITCODE -ne 0) { throw "AWS CLI failed: aws $($args -join ' ')" }
    return $out
}
function Invoke-AwsJson { (Invoke-Aws @args --output json) -join "`n" | ConvertFrom-Json }
# Quiet yes/no check. Windows PowerShell 5 turns stderr text into a fatal error under 'Stop', so relax it here only.
function Test-Aws {
    $ErrorActionPreference = 'Continue'
    & aws --endpoint-url $Endpoint @args 2>&1 | Out-Null
    return ($LASTEXITCODE -eq 0)
}
# Optional steps: warn and carry on if Floci does not support something (listed as a limitation in the report).
function Try-Aws($what) {
    $ErrorActionPreference = 'Continue'
    $out = & aws --endpoint-url $Endpoint @args 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Warning "$what failed: $($out | Select-Object -Last 1)"; return $false }
    return $true
}
# JSON goes through files: Windows PowerShell 5 breaks quotes in JSON arguments. UTF-8 without BOM.
function JsonFile($name, $text) { $p = Join-Path $Tmp $name; [IO.File]::WriteAllText($p, $text); return "file://$p" }
function Policy($file) {
    (Get-Content (Join-Path $PSScriptRoot "policies\$file") -Raw).Replace('__REGION__', $Region).Replace('__ACCOUNT__', $Account).Replace('__POOL_ID__', $PoolId)
}
function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }

# ---------- Settings from Sohaila's Cognito step (never hard-coded) ----------
$cogFile = Join-Path $Root '..\leave-request-service\deploy\cognito-outputs.json'
if (-not (Test-Path $cogFile)) { throw "Missing $cogFile. Run services\leave-request-service\deploy\deploy-cognito.ps1 first." }
$cog = Get-Content $cogFile -Raw | ConvertFrom-Json
$PoolId = $cog.userPoolId; $ClientId = $cog.clientId
$Issuer = "http://localhost:4566/$PoolId"
$Account = Invoke-Aws sts get-caller-identity --query Account --output text
Write-Host "Cognito pool $PoolId, client $ClientId, account $Account"

# ---------- 1. Database URL in Secrets Manager ----------
Step 'Secret'
$envFile = Join-Path $Root '.env'
$dbUrl = $null
if (Test-Path $envFile) { $line = Select-String -Path $envFile -Pattern '^DATABASE_URL=(.+)$' | Select-Object -First 1; if ($line) { $dbUrl = $line.Matches[0].Groups[1].Value.Trim() } }
if (-not $dbUrl) { throw "DATABASE_URL is missing. Put it in $envFile (never commit that file)." }
$secretFile = JsonFile 'secret.json' (@{ databaseUrl = $dbUrl } | ConvertTo-Json -Compress)
if (Test-Aws secretsmanager describe-secret --secret-id $SecretName) {
    Invoke-Aws secretsmanager put-secret-value --secret-id $SecretName --secret-string $secretFile | Out-Null; Write-Host 'Secret updated'
} else {
    Invoke-Aws secretsmanager create-secret --name $SecretName --description 'Neon URL for the approval service' --secret-string $secretFile | Out-Null; Write-Host 'Secret created'
}
Remove-Item ($secretFile -replace '^file://', '') -Force   # never leave the password on disk

# ---------- 2. SNS topic for notifications ----------
Step 'SNS topic'
$TopicArn = Invoke-Aws sns create-topic --name $TopicName --query TopicArn --output text   # returns the existing topic if present
Write-Host "Topic: $TopicArn"

# ---------- 3. IAM role for the Lambda (least privilege) ----------
Step 'IAM role (Lambda)'
if (-not (Test-Aws iam get-role --role-name $RoleName)) {
    Invoke-Aws iam create-role --role-name $RoleName --assume-role-policy-document ("file://" + (Join-Path $PSScriptRoot 'policies\lambda-trust.json')) | Out-Null
    Write-Host "Created role $RoleName"
} else { Write-Host "Role exists: $RoleName" }
Invoke-Aws iam put-role-policy --role-name $RoleName --policy-name approvals-fn-least-privilege --policy-document (JsonFile 'role-policy.json' (Policy 'approvals-fn-policy.json')) | Out-Null
$RoleArn = Invoke-Aws iam get-role --role-name $RoleName --query Role.Arn --output text

# ---------- 4. Build and deploy the Lambda ----------
Step 'Lambda build'
$build = Join-Path $Tmp 'build'; $zip = Join-Path $Tmp 'approvals-fn.zip'
if (Test-Path $build) { Remove-Item $build -Recurse -Force }
New-Item -ItemType Directory $build | Out-Null
Copy-Item (Join-Path $Root 'src') $build -Recurse
Copy-Item (Join-Path $Root 'package.json') $build
if (Test-Path (Join-Path $Root 'package-lock.json')) { Copy-Item (Join-Path $Root 'package-lock.json') $build }
Push-Location $build
try {
    if (Test-Path 'package-lock.json') { npm ci --omit=dev --no-audit --no-fund | Out-Null } else { npm install --omit=dev --no-audit --no-fund | Out-Null }
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
} finally { Pop-Location }
if (Test-Path $zip) { Remove-Item $zip -Force }
tar.exe -a -c -f $zip -C $build src node_modules package.json
Write-Host ("Package size: {0:N1} MB" -f ((Get-Item $zip).Length / 1MB))

Step 'Lambda function'
$SmArn = "arn:aws:states:${Region}:${Account}:stateMachine:$SmName"
function LambdaEnv {
    $vars = [ordered]@{
        AWS_ENDPOINT_URL = $InsideEndpoint
        COGNITO_USER_POOL_ID = $PoolId; COGNITO_CLIENT_ID = $ClientId
        COGNITO_ISSUER = $Issuer; COGNITO_JWKS_URL = "$InsideEndpoint/$PoolId/.well-known/jwks.json"
        CORS_ORIGIN = $FrontendOrigin; SECRET_NAME = $SecretName; EVENT_BUS_NAME = $Bus
        NOTIFY_TOPIC_ARN = $TopicArn; ESCALATION_STATE_MACHINE_ARN = $SmArn
        DEMO_MODE = $(if ($DemoMode) { 'true' } else { 'false' }); NODE_ENV = 'production'
    }
    return JsonFile 'lambda-env.json' (@{ Variables = $vars } | ConvertTo-Json -Compress)
}
if ($DemoMode) { Write-Host 'DEMO_MODE on: managers have 2 minutes before a request escalates to HR' -ForegroundColor Yellow }

if (Test-Aws lambda get-function --function-name $FnName) {
    Invoke-Aws lambda update-function-code --function-name $FnName --zip-file "fileb://$zip" | Out-Null
    try { Invoke-Aws lambda wait function-updated --function-name $FnName } catch {}
    Invoke-Aws lambda update-function-configuration --function-name $FnName --environment (LambdaEnv) --timeout 30 --memory-size 512 | Out-Null
    Write-Host "Updated $FnName"
} else {
    Invoke-Aws lambda create-function --function-name $FnName --runtime nodejs20.x --handler src/handler.handler `
        --role $RoleArn --zip-file "fileb://$zip" --timeout 30 --memory-size 512 --environment (LambdaEnv) | Out-Null
    Write-Host "Created $FnName"
}
try { Invoke-Aws lambda wait function-active-v2 --function-name $FnName } catch {}
$FnArn = Invoke-Aws lambda get-function --function-name $FnName --query Configuration.FunctionArn --output text

$logGroup = "/aws/lambda/$FnName"
if (Test-Aws logs create-log-group --log-group-name $logGroup) { Write-Host "Created log group $logGroup" }
Invoke-Aws logs put-retention-policy --log-group-name $logGroup --retention-in-days 14 | Out-Null

# ---------- 5. Step Functions escalation timer ----------
Step 'Step Functions'
if (-not (Test-Aws iam get-role --role-name $SmRoleName)) {
    Invoke-Aws iam create-role --role-name $SmRoleName --assume-role-policy-document ("file://" + (Join-Path $PSScriptRoot 'policies\states-trust.json')) | Out-Null
}
Invoke-Aws iam put-role-policy --role-name $SmRoleName --policy-name approvals-sfn-least-privilege --policy-document (JsonFile 'sfn-policy.json' (Policy 'states-policy.json')) | Out-Null
$SmRoleArn = Invoke-Aws iam get-role --role-name $SmRoleName --query Role.Arn --output text
$def = JsonFile 'state-machine.json' ((Get-Content (Join-Path $PSScriptRoot 'state-machine.json') -Raw).Replace('__FUNCTION_ARN__', $FnArn))
if (Test-Aws stepfunctions describe-state-machine --state-machine-arn $SmArn) {
    Invoke-Aws stepfunctions update-state-machine --state-machine-arn $SmArn --definition $def --role-arn $SmRoleArn | Out-Null; Write-Host "Updated $SmName"
} else {
    $SmArn = Invoke-Aws stepfunctions create-state-machine --name $SmName --definition $def --role-arn $SmRoleArn --query stateMachineArn --output text
    Write-Host "Created $SmName"
}

# ---------- 6. EventBridge bus and every rule between the three services ----------
Step 'EventBridge bus and rules'
if (Test-Aws events describe-event-bus --name $Bus) { Write-Host "Bus exists: $Bus" }
else { Invoke-Aws events create-event-bus --name $Bus | Out-Null; Write-Host "Created bus $Bus" }

# Targets are named by convention, so a rule can exist before the other members deploy their part.
$requestsFn    = "arn:aws:lambda:${Region}:${Account}:function:requests-fn"
$balancesInbox = "arn:aws:sqs:${Region}:${Account}:balances-inbox"
$auditInbox    = "arn:aws:sqs:${Region}:${Account}:audit-inbox"
$rules = @(
    @{ name = 'submitted-to-approvals'; pattern = @{ source = @('leaveflow.requests'); 'detail-type' = @('request.submitted') };
       targets = @(@{ Id = 'approvals-fn'; Arn = $FnArn }) },
    @{ name = 'cancelled-to-approvals-and-balances'; pattern = @{ source = @('leaveflow.requests'); 'detail-type' = @('request.cancelled') };
       targets = @(@{ Id = 'approvals-fn'; Arn = $FnArn }, @{ Id = 'balances-inbox'; Arn = $balancesInbox }) },
    @{ name = 'decisions-to-requests-and-balances'; pattern = @{ source = @('leaveflow.approvals'); 'detail-type' = @('request.approved', 'request.rejected') };
       targets = @(@{ Id = 'requests-fn'; Arn = $requestsFn }, @{ Id = 'balances-inbox'; Arn = $balancesInbox }) },
    @{ name = 'audit-to-audit-inbox'; pattern = @{ 'detail-type' = @('audit') };
       targets = @(@{ Id = 'audit-inbox'; Arn = $auditInbox }) }
)
foreach ($r in $rules) {
    $patternFile = JsonFile "pattern-$($r.name).json" ($r.pattern | ConvertTo-Json -Compress -Depth 5)
    Invoke-Aws events put-rule --name $r.name --event-bus-name $Bus --event-pattern $patternFile --state ENABLED | Out-Null
    foreach ($t in $r.targets) {
        $tFile = JsonFile "targets-$($r.name)-$($t.Id).json" (ConvertTo-Json -InputObject @($t) -Compress -Depth 5)
        $ok = Try-Aws "Target $($t.Id) on $($r.name)" events put-targets --rule $r.name --event-bus-name $Bus --targets $tFile
        Write-Host ("  {0,-38} -> {1}{2}" -f $r.name, $t.Id, $(if ($ok) { '' } else { '  (retry after its owner deploys)' }))
    }
}

# ---------- 7. Who may invoke approvals-fn ----------
Step 'Invoke permissions'
foreach ($p in @(
    @{ id = 'leaveflow-bus-rules'; principal = 'events.amazonaws.com'; arn = "arn:aws:events:${Region}:${Account}:rule/$Bus/*" },
    @{ id = 'escalation-timer';    principal = 'states.amazonaws.com'; arn = $SmArn })) {
    if (-not (Test-Aws lambda add-permission --function-name $FnName --statement-id $p.id --action lambda:InvokeFunction --principal $p.principal --source-arn $p.arn)) {
        Write-Host "  permission $($p.id) already present"
    } else { Write-Host "  permission $($p.id) added" }
}

# ---------- 8. CloudWatch metric filters and alarms ----------
Step 'CloudWatch alarms'
$filters = @(
    @{ group = $logGroup;                 name = 'approvals-access-denied'; metric = 'ApprovalsAccessDenied'; pattern = '{ $.event = "ACCESS_DENIED" }' },
    @{ group = $logGroup;                 name = 'approvals-escalated';     metric = 'RequestsEscalated';     pattern = '{ $.event = "ESCALATED" }' },
    @{ group = '/aws/lambda/requests-fn'; name = 'requests-login-failed';   metric = 'LoginFailed';           pattern = '{ $.event = "LOGIN_FAILED" }' }
)
foreach ($f in $filters) {
    $in = @{ logGroupName = $f.group; filterName = $f.name; filterPattern = $f.pattern
             metricTransformations = @(@{ metricName = $f.metric; metricNamespace = 'LeaveFlow'; metricValue = '1'; defaultValue = 0 }) }
    $ok = Try-Aws "Metric filter $($f.name)" logs put-metric-filter --cli-input-json (JsonFile "mf-$($f.name).json" ($in | ConvertTo-Json -Compress -Depth 5))
    if ($ok) { Write-Host "  metric filter $($f.name) on $($f.group)" }
}
$alarms = @(
    @{ AlarmName = 'leaveflow-access-denied-spike'; AlarmDescription = 'More than 10 ACCESS_DENIED in 5 minutes on approvals-api'
       Namespace = 'LeaveFlow'; MetricName = 'ApprovalsAccessDenied'; Statistic = 'Sum'; Period = 300; EvaluationPeriods = 1; Threshold = 10; ComparisonOperator = 'GreaterThanThreshold' },
    @{ AlarmName = 'leaveflow-failed-logins'; AlarmDescription = 'More than 5 failed logins in 5 minutes (read from the requests service logs)'
       Namespace = 'LeaveFlow'; MetricName = 'LoginFailed'; Statistic = 'Sum'; Period = 300; EvaluationPeriods = 1; Threshold = 5; ComparisonOperator = 'GreaterThanThreshold' },
    @{ AlarmName = 'leaveflow-escalation-failed'; AlarmDescription = 'An escalation timer (Step Functions) failed'
       Namespace = 'AWS/States'; MetricName = 'ExecutionsFailed'; Statistic = 'Sum'; Period = 300; EvaluationPeriods = 1; Threshold = 0; ComparisonOperator = 'GreaterThanThreshold'
       Dimensions = @(@{ Name = 'StateMachineArn'; Value = $SmArn }) }
)
foreach ($a in $alarms) {
    $a.AlarmActions = @($TopicArn); $a.TreatMissingData = 'notBreaching'
    $ok = Try-Aws "Alarm $($a.AlarmName)" cloudwatch put-metric-alarm --cli-input-json (JsonFile "alarm-$($a.AlarmName).json" ($a | ConvertTo-Json -Compress -Depth 5))
    if ($ok) { Write-Host "  alarm $($a.AlarmName)" }
}

# ---------- 9. HTTP API with Cognito JWT authorizer ----------
Step 'API Gateway'
$api = (Invoke-AwsJson apigatewayv2 get-apis).Items | Where-Object Name -eq $ApiName | Select-Object -First 1
if (-not $api) { $api = Invoke-AwsJson apigatewayv2 create-api --name $ApiName --protocol-type HTTP; Write-Host "Created $ApiName" }
$ApiId = $api.ApiId

$auth = (Invoke-AwsJson apigatewayv2 get-authorizers --api-id $ApiId).Items | Where-Object Name -eq 'cognito-jwt' | Select-Object -First 1
$jwtCfg = JsonFile 'jwt.json' (@{ Audience = @($ClientId); Issuer = $Issuer } | ConvertTo-Json -Compress)
if (-not $auth) {
    $auth = Invoke-AwsJson apigatewayv2 create-authorizer --api-id $ApiId --name cognito-jwt --authorizer-type JWT `
        --identity-source '$request.header.Authorization' --jwt-configuration $jwtCfg
}
$AuthId = $auth.AuthorizerId

$int = (Invoke-AwsJson apigatewayv2 get-integrations --api-id $ApiId).Items | Where-Object IntegrationUri -eq $FnArn | Select-Object -First 1
if (-not $int) {
    $int = Invoke-AwsJson apigatewayv2 create-integration --api-id $ApiId --integration-type AWS_PROXY `
        --integration-uri $FnArn --payload-format-version 2.0
}
$IntId = $int.IntegrationId

# Public: health and CORS preflight only. Everything else: API Gateway rejects a missing or bad token with 401 before Lambda runs.
$public = 'GET /health', 'OPTIONS /{proxy+}'
$protected = 'ANY /approvals', 'ANY /approvals/{proxy+}', 'ANY /notifications', 'ANY /notifications/{proxy+}', 'GET /team-calendar'
$existing = (Invoke-AwsJson apigatewayv2 get-routes --api-id $ApiId).Items
foreach ($rk in $public + $protected) {
    $isProtected = $protected -contains $rk
    $route = $existing | Where-Object RouteKey -eq $rk | Select-Object -First 1
    $authArgs = if ($isProtected) { @('--authorization-type', 'JWT', '--authorizer-id', $AuthId) } else { @('--authorization-type', 'NONE') }
    if ($route) { Invoke-Aws apigatewayv2 update-route --api-id $ApiId --route-id $route.RouteId --target "integrations/$IntId" @authArgs | Out-Null }
    else { Invoke-Aws apigatewayv2 create-route --api-id $ApiId --route-key $rk --target "integrations/$IntId" @authArgs | Out-Null }
    Write-Host ("  {0,-32} {1}" -f $rk, $(if ($isProtected) { 'JWT' } else { 'public' }))
}

$stages = (Invoke-AwsJson apigatewayv2 get-stages --api-id $ApiId).Items
if (-not ($stages | Where-Object StageName -eq '$default')) {
    Invoke-Aws apigatewayv2 create-stage --api-id $ApiId --stage-name '$default' --auto-deploy `
        --default-route-settings 'ThrottlingBurstLimit=20,ThrottlingRateLimit=10' | Out-Null
}
if (-not (Test-Aws lambda add-permission --function-name $FnName --statement-id approvals-api-invoke --action lambda:InvokeFunction `
        --principal apigateway.amazonaws.com --source-arn "arn:aws:execute-api:${Region}:${Account}:$ApiId/*/*")) {
    Write-Host '  permission approvals-api-invoke already present'
}

# ---------- 10. Outputs and smoke test ----------
$ApiUrl = "http://$ApiId.execute-api.localhost.floci.io:4566"
@{ apiId = $ApiId; apiUrl = $ApiUrl; functionArn = $FnArn; topicArn = $TopicArn; stateMachineArn = $SmArn; bus = $Bus; secretName = $SecretName } |
    ConvertTo-Json | Set-Content (Join-Path $PSScriptRoot 'approvals-outputs.json')
Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue

Step 'Smoke test'
Write-Host "API: $ApiUrl"
Write-Host 'First call can take ~30 s while Floci starts the Lambda container...'
try {
    $h = Invoke-RestMethod "$ApiUrl/health" -TimeoutSec 90
    Write-Host "GET /health -> $($h.status)" -ForegroundColor Green
} catch { Write-Warning "GET /health failed: $($_.Exception.Message)" }
try { Invoke-RestMethod "$ApiUrl/approvals" -TimeoutSec 30 | Out-Null; Write-Warning 'No token was accepted - check the JWT authorizer' }
catch {
    if ($_.Exception.Response) { Write-Host "GET /approvals without token -> $([int]$_.Exception.Response.StatusCode) (expected 401)" -ForegroundColor Green }
    else { Write-Warning "Could not reach the API: $($_.Exception.Message)" }
}
Write-Host "`nDone. Share apiUrl with the team: $ApiUrl"

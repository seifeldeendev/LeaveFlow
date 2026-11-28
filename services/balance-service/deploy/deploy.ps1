param([switch]$SkipAlarms)

$ErrorActionPreference = 'Stop'
$Endpoint = if ($env:AWS_ENDPOINT_URL) { $env:AWS_ENDPOINT_URL } else { 'http://localhost:4566' }
$Region   = 'us-east-1'
$env:AWS_DEFAULT_REGION = $Region
$Root     = Split-Path $PSScriptRoot -Parent
$Tmp      = Join-Path $env:TEMP 'leaveflow-balances-deploy'
New-Item -ItemType Directory -Force $Tmp | Out-Null

$InsideEndpoint = 'http://host.docker.internal:4566'
$FrontendOrigins = @('http://localhost:8080', 'http://leaveflow-frontend.s3-website.localhost.floci.io:4566')
$FrontendOrigin = $FrontendOrigins -join ','
$FnName = 'balance-projection-fn'; $RoleName = 'balances-fn-role'
$ApiName = 'balances-api'; $SecretName = 'leaveflow/balances'; $QueueName = 'balances-inbox'

function Invoke-Aws {
    $out = & aws --endpoint-url $Endpoint --cli-read-timeout 600 @args
    if ($LASTEXITCODE -ne 0) { throw "AWS CLI failed: aws $($args -join ' ')" }
    return $out
}
function Invoke-AwsJson { (Invoke-Aws @args --output json) -join "`n" | ConvertFrom-Json }
function Test-Aws {
    $ErrorActionPreference = 'Continue'
    & aws --endpoint-url $Endpoint @args 2>&1 | Out-Null
    return ($LASTEXITCODE -eq 0)
}
function Try-Aws($what) {
    $ErrorActionPreference = 'Continue'
    $out = & aws --endpoint-url $Endpoint @args 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Warning "$what failed: $($out | Select-Object -Last 1)"; return $false }
    return $true
}
function JsonFile($name, $text) { $p = Join-Path $Tmp $name; [IO.File]::WriteAllText($p, $text, [Text.UTF8Encoding]::new($false)); return "file://$p" }
function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }

$cogFile = Join-Path $Root '..\leave-request-service\deploy\cognito-outputs.json'
if (-not (Test-Path $cogFile)) { throw "Missing $cogFile. Run deploy-cognito.ps1 first." }
$cog = Get-Content $cogFile -Raw | ConvertFrom-Json
$PoolId = $cog.userPoolId; $ClientId = $cog.clientId
$Issuer = "http://localhost:4566/$PoolId"
$Account = Invoke-Aws sts get-caller-identity --query Account --output text

Step 'SSM policy parameters'
$policies = @(
    @{ name = '/leaveflow/balances/annual-monthly-accrual'; value = '1.75' },
    @{ name = '/leaveflow/balances/carryover-cap';            value = '5' },
    @{ name = '/leaveflow/balances/casual-yearly';            value = '6' }
)
foreach ($p in $policies) {
    Invoke-Aws ssm put-parameter --name $p.name --type String --value $p.value --overwrite | Out-Null
    Write-Host "  parameter $($p.name) = $($p.value)"
}

Step 'Secret'
$envFile = Join-Path $Root '.env'
$dbUrl = $null
if (Test-Path $envFile) { $line = Select-String -Path $envFile -Pattern '^DATABASE_URL=(.+)$' | Select-Object -First 1; if ($line) { $dbUrl = $line.Matches[0].Groups[1].Value.Trim() } }
if (-not $dbUrl) { throw "DATABASE_URL is missing. Put it in $envFile (never commit that file)." }
$secretFile = JsonFile 'secret.json' (@{ databaseUrl = $dbUrl } | ConvertTo-Json -Compress)
try {
    if (Test-Aws secretsmanager describe-secret --secret-id $SecretName) {
        Invoke-Aws secretsmanager put-secret-value --secret-id $SecretName --secret-string $secretFile | Out-Null
        Write-Host 'Secret updated'
    } else {
        Invoke-Aws secretsmanager create-secret --name $SecretName --description 'Neon URL for the balance service' --secret-string $secretFile | Out-Null
        Write-Host 'Secret created'
    }
} finally {
    $secretPath = $secretFile -replace '^file://', ''
    if (Test-Path $secretPath) { Remove-Item -LiteralPath $secretPath -Force }
}

Step 'SQS queues and DLQs'
$AuditQueueName = 'audit-inbox'
$DlqSuffix = '-dlq'
$MaxReceiveCount = 5
$VisibilityTimeout = 360
$ReceiveWaitTime = 20

function Ensure-Queue($name) {
    $oldEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $url = & aws --endpoint-url $Endpoint sqs get-queue-url --queue-name $name --query QueueUrl --output text 2>$null
    $ErrorActionPreference = $oldEap
    if (-not $url) {
        $url = Invoke-Aws sqs create-queue --queue-name $name --query QueueUrl --output text
        Write-Host "  created queue $name"
    } else { Write-Host "  queue exists: $name" }
    if (-not $url) { throw "Queue $name could not be resolved." }
    $arn = Invoke-Aws sqs get-queue-attributes --queue-url $url --attribute-names QueueArn --query Attributes.QueueArn --output text
    if (-not $arn) { throw "Queue ARN for $name could not be resolved." }
    return @{ url = $url; arn = $arn }
}

$BalancesDlq = Ensure-Queue "$QueueName$DlqSuffix"
$AuditDlq    = Ensure-Queue "$AuditQueueName$DlqSuffix"
$BalancesQ   = Ensure-Queue $QueueName
$AuditQ      = Ensure-Queue $AuditQueueName
$QueueUrl    = $BalancesQ.url; $QueueArn = $BalancesQ.arn
$AuditQueueUrl = $AuditQ.url;  $AuditQueueArn = $AuditQ.arn

foreach ($q in @(@{ url = $QueueUrl; dlq = $BalancesDlq.arn }, @{ url = $AuditQueueUrl; dlq = $AuditDlq.arn })) {
    $redrive = @{ maxReceiveCount = "$MaxReceiveCount"; deadLetterTargetArn = $q.dlq } | ConvertTo-Json -Compress
    $attrs = @{
        RedrivePolicy = $redrive
        VisibilityTimeout = "$VisibilityTimeout"
        ReceiveMessageWaitTimeSeconds = "$ReceiveWaitTime"
    } | ConvertTo-Json -Compress
    Invoke-Aws sqs set-queue-attributes --queue-url $q.url --attributes (JsonFile 'queue-attrs.json' $attrs) | Out-Null
}

foreach ($q in @($BalancesQ, $AuditQ)) {
    $queuePolicy = (Get-Content (Join-Path $PSScriptRoot 'policies\balances-inbox-policy.json') -Raw).Replace('__ARN__', $q.arn).Replace('__REGION__', $Region).Replace('__ACCOUNT__', $Account)
    $queuePolicyAttr = @{ Policy = $queuePolicy } | ConvertTo-Json -Compress -Depth 10
    Invoke-Aws sqs set-queue-attributes --queue-url $q.url --attributes (JsonFile 'queue-policy.json' $queuePolicyAttr) | Out-Null
    Write-Host "  queue policy applied to $($q.arn)"
}

Step 'IAM role'
if (-not (Test-Aws iam get-role --role-name $RoleName)) {
    Invoke-Aws iam create-role --role-name $RoleName --assume-role-policy-document ("file://" + (Join-Path $PSScriptRoot 'policies\lambda-trust.json')) | Out-Null
    Write-Host "Created role $RoleName"
} else { Write-Host "Role exists: $RoleName" }
$pol = (Get-Content (Join-Path $PSScriptRoot 'policies\balances-fn-policy.json') -Raw).Replace('__REGION__', $Region).Replace('__ACCOUNT__', $Account).Replace('__POOL_ID__', $PoolId)
Invoke-Aws iam put-role-policy --role-name $RoleName --policy-name balances-fn-least-privilege --policy-document (JsonFile 'role-policy.json' $pol) | Out-Null
$RoleArn = Invoke-Aws iam get-role --role-name $RoleName --query Role.Arn --output text

Step 'Lambda build'
$build = Join-Path $Tmp 'build'; $zip = Join-Path $Tmp 'balances-fn.zip'
if (Test-Path $build) { Remove-Item $build -Recurse -Force }
New-Item -ItemType Directory $build | Out-Null
Copy-Item (Join-Path $Root 'src') $build -Recurse
Copy-Item (Join-Path $Root 'package.json'), (Join-Path $Root 'package-lock.json') $build
Push-Location $build
try { npm ci --omit=dev --no-audit --no-fund | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' } } finally { Pop-Location }
if (Test-Path $zip) { Remove-Item $zip -Force }
tar.exe -a -c -f $zip -C $build src node_modules package.json
Write-Host ("Package size: {0:N1} MB" -f ((Get-Item $zip).Length / 1MB))

Step 'Lambda function'
$vars = [ordered]@{
    AWS_ENDPOINT_URL = $InsideEndpoint
    COGNITO_USER_POOL_ID = $PoolId; COGNITO_CLIENT_ID = $ClientId
    COGNITO_ISSUER = $Issuer; COGNITO_JWKS_URL = "$InsideEndpoint/$PoolId/.well-known/jwks.json"
    CORS_ORIGIN = $FrontendOrigin; SECRET_NAME = $SecretName; EVENT_BUS_NAME = 'leaveflow-bus'
    BALANCE_INBOX_URL = $QueueUrl; NODE_ENV = 'production'
}
$envArg = JsonFile 'lambda-env.json' (@{ Variables = $vars } | ConvertTo-Json -Compress)
if (Test-Aws lambda get-function --function-name $FnName) {
    Invoke-Aws lambda update-function-code --function-name $FnName --zip-file "fileb://$zip" | Out-Null
    try { Invoke-Aws lambda wait function-updated --function-name $FnName } catch {}
    Invoke-Aws lambda update-function-configuration --function-name $FnName --environment $envArg --timeout 60 --memory-size 512 | Out-Null
    Write-Host "Updated $FnName"
} else {
    Invoke-Aws lambda create-function --function-name $FnName --runtime nodejs20.x --handler src/handler.handler `
        --role $RoleArn --zip-file "fileb://$zip" --timeout 60 --memory-size 512 --environment $envArg | Out-Null
    Write-Host "Created $FnName"
}
try { Invoke-Aws lambda wait function-active-v2 --function-name $FnName } catch {}
$FnArn = Invoke-Aws lambda get-function --function-name $FnName --query Configuration.FunctionArn --output text

Step 'SQS event source mapping'
foreach ($m in @(@{ arn = $QueueArn; name = 'balances-inbox' }, @{ arn = $AuditQueueArn; name = 'audit-inbox' })) {
    if (Test-Aws lambda list-event-source-mappings --function-name $FnName --event-source-arn $m.arn --query 'EventSourceMappings[0].UUID' --output text) {
        Write-Host "  event source mapping already present for $($m.name)"
    } else {
        Invoke-Aws lambda create-event-source-mapping --function-name $FnName --event-source-arn $m.arn --batch-size 10 | Out-Null
        Write-Host "  created event source mapping for $($m.name)"
    }
}

Step 'CloudWatch'
$logGroup = "/aws/lambda/$FnName"
if (Test-Aws logs create-log-group --log-group-name $logGroup) { Write-Host "Created log group $logGroup" }
Invoke-Aws logs put-retention-policy --log-group-name $logGroup --retention-in-days 14 | Out-Null
if (-not $SkipAlarms) {
    $filters = @(
        @{ name = 'balances-access-denied'; metric = 'BalancesAccessDenied'; pattern = '"\"event\":\"ACCESS_DENIED\""' },
        @{ name = 'balances-event-rejected'; metric = 'BalancesEventRejected'; pattern = '"\"event\":\"EVENT_REJECTED\""' }
    )
    foreach ($f in $filters) {
        $in = @{ logGroupName = $logGroup; filterName = $f.name; filterPattern = $f.pattern
                 metricTransformations = @(@{ metricName = $f.metric; metricNamespace = 'LeaveFlow'; metricValue = '1'; defaultValue = 0 }) }
        $ok = Try-Aws "Metric filter $($f.name)" logs put-metric-filter --cli-input-json (JsonFile "mf-$($f.name).json" ($in | ConvertTo-Json -Compress -Depth 5))
        if ($ok) { Write-Host "  metric filter $($f.name)" }
    }
    $alarm = @{ AlarmName = 'leaveflow-balances-access-denied-spike'
                AlarmDescription = 'More than 10 ACCESS_DENIED in 5 minutes on balances-api'
                Namespace = 'LeaveFlow'; MetricName = 'BalancesAccessDenied'; Statistic = 'Sum'
                Period = 300; EvaluationPeriods = 1; Threshold = 10; ComparisonOperator = 'GreaterThanThreshold'
                TreatMissingData = 'notBreaching' }
    Invoke-Aws cloudwatch put-metric-alarm --cli-input-json (JsonFile 'alarm.json' ($alarm | ConvertTo-Json -Compress -Depth 5)) | Out-Null
    Write-Host '  alarm leaveflow-balances-access-denied-spike'

    foreach ($dlq in @(@{ name = 'balances-inbox-dlq'; arn = $BalancesDlq.arn }, @{ name = 'audit-inbox-dlq'; arn = $AuditDlq.arn })) {
        $dlqAlarm = @{
            AlarmName = "leaveflow-$($dlq.name)-messages"
            AlarmDescription = "Messages visible in $($dlq.name); events failed after $MaxReceiveCount receives"
            Namespace = 'AWS/SQS'; MetricName = 'ApproximateNumberOfMessagesVisible'
            Dimensions = @(@{ Name = 'QueueName'; Value = $dlq.name })
            Statistic = 'Maximum'; Period = 60; EvaluationPeriods = 1
            Threshold = 1; ComparisonOperator = 'GreaterThanOrEqualToThreshold'
            TreatMissingData = 'notBreaching'
        }
        Invoke-Aws cloudwatch put-metric-alarm --cli-input-json (JsonFile "alarm-$($dlq.name).json" ($dlqAlarm | ConvertTo-Json -Compress -Depth 5)) | Out-Null
        Write-Host "  alarm leaveflow-$($dlq.name)-messages"
    }
}

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
$public = 'GET /health', 'OPTIONS /{proxy+}'
$protected = 'GET /balances/me', 'GET /balances/me/ledger', 'GET /balances', 'GET /balances/{id}/ledger',
             'POST /balances/{id}/adjustments', 'GET /accrual-runs', 'POST /accrual-runs', 'GET /accrual-runs/{month}/details'
$existing = (Invoke-AwsJson apigatewayv2 get-routes --api-id $ApiId).Items
foreach ($rk in $public + $protected) {
    $isProtected = $protected -contains $rk
    $route = $existing | Where-Object RouteKey -eq $rk | Select-Object -First 1
    $gatewayJwt = $env:LEAVEFLOW_GATEWAY_JWT -eq 'true'
    $authArgs = if ($isProtected -and $gatewayJwt) { @('--authorization-type', 'JWT', '--authorizer-id', $AuthId) } else { @('--authorization-type', 'NONE') }
    if ($route) { Invoke-Aws apigatewayv2 update-route --api-id $ApiId --route-id $route.RouteId --target "integrations/$IntId" @authArgs | Out-Null }
    else { Invoke-Aws apigatewayv2 create-route --api-id $ApiId --route-key $rk --target "integrations/$IntId" @authArgs | Out-Null }
    Write-Host ("  {0,-32} {1}" -f $rk, $(if (-not $isProtected) { 'public' } elseif ($gatewayJwt) { 'JWT at gateway + Lambda' } else { 'JWT checked in Lambda' }))
}
$stages = (Invoke-AwsJson apigatewayv2 get-stages --api-id $ApiId).Items
if (-not ($stages | Where-Object StageName -eq '$default')) {
    Invoke-Aws apigatewayv2 create-stage --api-id $ApiId --stage-name '$default' --auto-deploy `
        --default-route-settings 'ThrottlingBurstLimit=20,ThrottlingRateLimit=10' | Out-Null
}

Step 'Invoke permissions'
foreach ($p in @(
    @{ id = 'balances-api-invoke'; principal = 'apigateway.amazonaws.com'; arn = "arn:aws:execute-api:${Region}:${Account}:$ApiId/*/*" },
    @{ id = 'requests-fn-invoke';  principal = 'lambda.amazonaws.com';     arn = "arn:aws:lambda:${Region}:${Account}:function:requests-fn" },
    @{ id = 'leaveflow-bus-rules'; principal = 'events.amazonaws.com';     arn = "arn:aws:events:${Region}:${Account}:rule/leaveflow-bus/*" })) {
    if (-not (Test-Aws lambda add-permission --function-name $FnName --statement-id $p.id --action lambda:InvokeFunction --principal $p.principal --source-arn $p.arn --source-account $Account)) {
        Write-Host "  permission $($p.id) already present"
    }
}

$ApiUrl = "http://$ApiId.execute-api.localhost.floci.io:4566"
@{ apiId = $ApiId; apiUrl = $ApiUrl; functionArn = $FnArn; queueUrl = $QueueUrl; queueArn = $QueueArn;
   secretName = $SecretName; bus = 'leaveflow-bus' } | ConvertTo-Json | Set-Content (Join-Path $PSScriptRoot 'balances-outputs.json')
Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue

Step 'Smoke test'
Write-Host "API: $ApiUrl"
try {
    $h = Invoke-RestMethod "$ApiUrl/health" -TimeoutSec 90
    Write-Host "GET /health -> $($h.status)" -ForegroundColor Green
} catch { Write-Warning "GET /health failed: $($_.Exception.Message)" }
try { Invoke-RestMethod "$ApiUrl/balances/me" -TimeoutSec 30 | Out-Null; Write-Warning 'No token was accepted - check the JWT authorizer' }
catch {
    if ($_.Exception.Response) { Write-Host "GET /balances/me without token -> $([int]$_.Exception.Response.StatusCode) (expected 401)" -ForegroundColor Green }
    else { Write-Warning "Could not reach the API: $($_.Exception.Message)" }
}
Write-Host "`nDone. Share apiUrl with the team: $ApiUrl"

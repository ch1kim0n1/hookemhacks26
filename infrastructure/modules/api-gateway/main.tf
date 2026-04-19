terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}

locals {
  tags = merge({ Component = var.name }, var.tags)

  sign_tx_source_dir = "${path.module}/../../lambdas/sign_tx"
  detect_source_dir  = "${path.module}/../../lambdas/detect"

  # We ship sign-tx with pip-installed deps; detect is pure boto3 so the dir
  # can zip as-is.
  sign_tx_zip = "${path.module}/build/sign_tx.zip"
  detect_zip  = "${path.module}/build/detect.zip"
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

# ---------------------------------------------------------------------------
# Lambda build
#
# sign_tx needs coincurve + eth-utils at runtime (pure-boto3 isn't enough to
# decode the KMS signature + recover v). We install them into a `build/` dir
# and zip with a null_resource to keep deps reproducible across apply runs.
# detect is pure boto3 so we zip the source directory directly.
# ---------------------------------------------------------------------------

resource "null_resource" "sign_tx_build" {
  triggers = {
    source_hash = filesha256("${local.sign_tx_source_dir}/main.py")
    reqs_hash   = filesha256("${local.sign_tx_source_dir}/requirements.txt")
  }

  provisioner "local-exec" {
    command     = <<-BASH
      set -euo pipefail
      BUILD_DIR="${path.module}/build/sign_tx_src"
      rm -rf "$BUILD_DIR"
      mkdir -p "$BUILD_DIR"
      cp "${local.sign_tx_source_dir}/main.py" "$BUILD_DIR/"
      pip install \
        --quiet \
        --target "$BUILD_DIR" \
        --platform manylinux2014_x86_64 \
        --only-binary=:all: \
        --python-version 3.12 \
        --implementation cp \
        -r "${local.sign_tx_source_dir}/requirements.txt"
    BASH
    interpreter = ["/bin/bash", "-c"]
  }
}

data "archive_file" "sign_tx" {
  type        = "zip"
  source_dir  = "${path.module}/build/sign_tx_src"
  output_path = local.sign_tx_zip

  depends_on = [null_resource.sign_tx_build]
}

data "archive_file" "detect" {
  type        = "zip"
  source_dir  = local.detect_source_dir
  output_path = local.detect_zip
}

# ---------------------------------------------------------------------------
# IAM — one execution role per Lambda
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# sign-tx: needs Sign + GetPublicKey on every node's signing key.
resource "aws_iam_role" "sign_tx" {
  name               = "${var.name}-sign-tx-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags               = local.tags
}

data "aws_iam_policy_document" "sign_tx_inline" {
  statement {
    sid     = "SignOnNodeKeys"
    effect  = "Allow"
    actions = [
      "kms:Sign",
      "kms:GetPublicKey",
      "kms:DescribeKey",
    ]
    resources = var.node_signing_key_arns
  }

  statement {
    sid     = "Logs"
    effect  = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["arn:${data.aws_partition.current.partition}:logs:*:*:*"]
  }
}

resource "aws_iam_role_policy" "sign_tx_inline" {
  name   = "${var.name}-sign-tx-inline"
  role   = aws_iam_role.sign_tx.id
  policy = data.aws_iam_policy_document.sign_tx_inline.json
}

# detect: needs Bedrock invoke + logs.
resource "aws_iam_role" "detect" {
  name               = "${var.name}-detect-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "detect_bedrock" {
  role       = aws_iam_role.detect.name
  policy_arn = var.bedrock_policy_arn
}

data "aws_iam_policy_document" "detect_inline" {
  statement {
    sid     = "Logs"
    effect  = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["arn:${data.aws_partition.current.partition}:logs:*:*:*"]
  }
}

resource "aws_iam_role_policy" "detect_inline" {
  name   = "${var.name}-detect-inline"
  role   = aws_iam_role.detect.id
  policy = data.aws_iam_policy_document.detect_inline.json
}

# ---------------------------------------------------------------------------
# Lambda functions
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "sign_tx" {
  name              = "/aws/lambda/${var.name}-sign-tx"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_cloudwatch_log_group" "detect" {
  name              = "/aws/lambda/${var.name}-detect"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_lambda_function" "sign_tx" {
  function_name    = "${var.name}-sign-tx"
  role             = aws_iam_role.sign_tx.arn
  handler          = "main.lambda_handler"
  runtime          = "python3.12"
  architectures    = ["x86_64"]
  filename         = data.archive_file.sign_tx.output_path
  source_code_hash = data.archive_file.sign_tx.output_base64sha256
  timeout          = 15
  memory_size      = 512
  tags             = local.tags

  environment {
    variables = {
      CLAWGUARD_NODE_ALIAS_PREFIX = var.node_alias_prefix
    }
  }

  depends_on = [aws_cloudwatch_log_group.sign_tx]
}

resource "aws_lambda_function" "detect" {
  function_name    = "${var.name}-detect"
  role             = aws_iam_role.detect.arn
  handler          = "main.lambda_handler"
  runtime          = "python3.12"
  architectures    = ["x86_64"]
  filename         = data.archive_file.detect.output_path
  source_code_hash = data.archive_file.detect.output_base64sha256
  timeout          = 30
  memory_size      = 512
  tags             = local.tags

  environment {
    variables = {
      CLAWGUARD_BEDROCK_MODEL_ID = var.bedrock_model_id
    }
  }

  depends_on = [aws_cloudwatch_log_group.detect]
}

# ---------------------------------------------------------------------------
# HTTP API Gateway with IAM authorisation
#
# Every request must carry an AWS SigV4 signature. The only principals that
# can produce a valid signature for this API's execute-arns are the node task
# roles (plus the root account) — anonymous callers get a 401 before the
# request ever reaches Lambda.
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_api" "this" {
  name          = var.name
  protocol_type = "HTTP"
  description   = "ClawGuard signer + detector surface. All routes IAM-auth."
  tags          = local.tags
}

resource "aws_apigatewayv2_integration" "sign_tx" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.sign_tx.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "detect" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.detect.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "sign_tx" {
  api_id             = aws_apigatewayv2_api.this.id
  route_key          = "POST /sign"
  target             = "integrations/${aws_apigatewayv2_integration.sign_tx.id}"
  authorization_type = "AWS_IAM"
}

resource "aws_apigatewayv2_route" "detect" {
  api_id             = aws_apigatewayv2_api.this.id
  route_key          = "POST /detect"
  target             = "integrations/${aws_apigatewayv2_integration.detect.id}"
  authorization_type = "AWS_IAM"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = var.throttle_burst
    throttling_rate_limit  = var.throttle_rate
  }

  tags = local.tags
}

resource "aws_lambda_permission" "sign_tx_api" {
  statement_id  = "AllowAPIGatewayInvokeSignTx"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.sign_tx.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "detect_api" {
  statement_id  = "AllowAPIGatewayInvokeDetect"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.detect.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*"
}

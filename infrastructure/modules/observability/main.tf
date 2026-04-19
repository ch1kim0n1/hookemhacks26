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
}

# ---------------------------------------------------------------------------
# SNS topic for critical alerts. Subscribers added via var.alert_emails;
# out-of-band attaching (e.g., PagerDuty) also works via aws_sns_topic_subscription.
# ---------------------------------------------------------------------------

resource "aws_sns_topic" "alerts" {
  name = "${var.name}-alerts"
  tags = local.tags
}

resource "aws_sns_topic_subscription" "email" {
  for_each = toset(var.alert_emails)

  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = each.value
}

# ---------------------------------------------------------------------------
# Metric filters — convert log lines to CloudWatch metrics. Keeps alarm
# configuration declarative and avoids custom metric PutMetricData calls.
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_metric_filter" "sign_failures" {
  count = length(var.sign_tx_log_group) > 0 ? 1 : 0

  name           = "${var.name}-sign-failures"
  log_group_name = var.sign_tx_log_group
  pattern        = "{ $.level = \"ERROR\" || $.error = * }"

  metric_transformation {
    name          = "SignFailures"
    namespace     = var.metrics_namespace
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_log_metric_filter" "detect_errors" {
  count = length(var.detect_log_group) > 0 ? 1 : 0

  name           = "${var.name}-detect-errors"
  log_group_name = var.detect_log_group
  pattern        = "{ $.errored = true || $.level = \"ERROR\" }"

  metric_transformation {
    name          = "DetectErrors"
    namespace     = var.metrics_namespace
    value         = "1"
    default_value = "0"
  }
}

# ---------------------------------------------------------------------------
# Alarms
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "sign_failures" {
  count = length(var.sign_tx_log_group) > 0 ? 1 : 0

  alarm_name          = "${var.name}-sign-failures"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  threshold           = var.sign_failure_threshold
  period              = 60
  statistic           = "Sum"
  metric_name         = "SignFailures"
  namespace           = var.metrics_namespace
  treat_missing_data  = "notBreaching"
  alarm_description   = "KMS signing errors in the last minute exceeded threshold."
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.tags
}

resource "aws_cloudwatch_metric_alarm" "detect_errors" {
  count = length(var.detect_log_group) > 0 ? 1 : 0

  alarm_name          = "${var.name}-detect-errors"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 2
  threshold           = var.detect_error_threshold
  period              = 60
  statistic           = "Sum"
  metric_name         = "DetectErrors"
  namespace           = var.metrics_namespace
  treat_missing_data  = "notBreaching"
  alarm_description   = "Bedrock detect errors elevated for two consecutive minutes."
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.tags
}

# Lambda-level throttling is a canary for API Gateway or concurrency mis-sizing.
resource "aws_cloudwatch_metric_alarm" "sign_tx_throttles" {
  count = length(var.sign_tx_function_name) > 0 ? 1 : 0

  alarm_name          = "${var.name}-sign-tx-throttles"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 0
  period              = 60
  statistic           = "Sum"
  metric_name         = "Throttles"
  namespace           = "AWS/Lambda"
  treat_missing_data  = "notBreaching"
  dimensions          = { FunctionName = var.sign_tx_function_name }
  alarm_description   = "sign-tx Lambda is being throttled — bump concurrency or investigate."
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = local.tags
}

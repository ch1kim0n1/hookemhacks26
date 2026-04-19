output "alerts_topic_arn" {
  description = "SNS topic ARN — publish here from other modules to page operators."
  value       = aws_sns_topic.alerts.arn
}

output "alerts_topic_name" {
  description = "SNS topic name."
  value       = aws_sns_topic.alerts.name
}

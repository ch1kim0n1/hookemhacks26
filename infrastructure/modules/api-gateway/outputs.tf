output "api_id" {
  description = "HTTP API id."
  value       = aws_apigatewayv2_api.this.id
}

output "api_endpoint" {
  description = "Invoke base URL (default stage)."
  value       = aws_apigatewayv2_api.this.api_endpoint
}

output "execute_arn" {
  description = "API execution ARN used in execute-api:Invoke IAM resources."
  value       = aws_apigatewayv2_api.this.execution_arn
}

output "sign_route_invoke_arn" {
  description = "Full IAM resource arn for POST /sign."
  value       = "${aws_apigatewayv2_api.this.execution_arn}/*/POST/sign"
}

output "detect_route_invoke_arn" {
  description = "Full IAM resource arn for POST /detect."
  value       = "${aws_apigatewayv2_api.this.execution_arn}/*/POST/detect"
}

output "sign_tx_function_name" {
  description = "sign-tx Lambda function name (for CloudWatch alarms)."
  value       = aws_lambda_function.sign_tx.function_name
}

output "detect_function_name" {
  description = "detect Lambda function name (for CloudWatch alarms)."
  value       = aws_lambda_function.detect.function_name
}

output "sign_tx_log_group" {
  description = "CloudWatch log group for sign-tx."
  value       = aws_cloudwatch_log_group.sign_tx.name
}

output "detect_log_group" {
  description = "CloudWatch log group for detect."
  value       = aws_cloudwatch_log_group.detect.name
}

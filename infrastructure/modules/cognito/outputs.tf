output "user_pool_id" {
  description = "Cognito user pool id."
  value       = aws_cognito_user_pool.this.id
}

output "user_pool_arn" {
  description = "Cognito user pool ARN."
  value       = aws_cognito_user_pool.this.arn
}

output "user_pool_client_id" {
  description = "App client id. Passed to the browser as `client_id`."
  value       = aws_cognito_user_pool_client.this.id
}

output "domain" {
  description = "Fully-qualified Cognito hosted-UI domain."
  value       = "${aws_cognito_user_pool_domain.this.domain}.auth.${data.aws_region.current.name}.amazoncognito.com"
}

output "hosted_ui_login_url" {
  description = "Pre-baked login URL. Share this with the judges."
  value = format(
    "https://%s.auth.%s.amazoncognito.com/login?client_id=%s&response_type=code&scope=email+openid+profile&redirect_uri=%s",
    aws_cognito_user_pool_domain.this.domain,
    data.aws_region.current.name,
    aws_cognito_user_pool_client.this.id,
    urlencode(var.callback_urls[0]),
  )
}

output "hosted_ui_signup_url" {
  description = "Pre-baked sign-up URL (lands directly on the register screen)."
  value = format(
    "https://%s.auth.%s.amazoncognito.com/signup?client_id=%s&response_type=code&scope=email+openid+profile&redirect_uri=%s",
    aws_cognito_user_pool_domain.this.domain,
    data.aws_region.current.name,
    aws_cognito_user_pool_client.this.id,
    urlencode(var.callback_urls[0]),
  )
}

data "aws_region" "current" {}

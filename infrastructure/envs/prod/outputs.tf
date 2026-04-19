output "account_id" {
  description = "AWS account id (from preflight)."
  value       = module.preflight.account_id
}

output "caller_arn" {
  description = "Authenticated principal ARN."
  value       = module.preflight.caller_arn
}

output "region" {
  description = "AWS region this env applies to."
  value       = module.preflight.region
}

output "site_bucket_name" {
  description = "S3 bucket holding static site content. Consumed by scripts/deploy-frontend.sh."
  value       = module.site.bucket_name
}

output "site_distribution_id" {
  description = "CloudFront distribution id. Consumed by scripts/deploy-frontend.sh for invalidations."
  value       = module.site.distribution_id
}

output "site_distribution_domain" {
  description = "Default *.cloudfront.net hostname for the site."
  value       = module.site.distribution_domain_name
}

output "site_distribution_hosted_zone_id" {
  description = "Zone id for Route53 ALIAS records pointing at the distribution."
  value       = module.site.distribution_hosted_zone_id
}

output "site_url" {
  description = "Public URL for the static site (https, CloudFront-managed cert)."
  value       = "https://${module.site.distribution_domain_name}/"
}

output "cognito_user_pool_id" {
  description = "Cognito user-pool id. Passed to the browser SDK."
  value       = module.cognito.user_pool_id
}

output "cognito_user_pool_client_id" {
  description = "Cognito app-client id. Passed to the browser SDK."
  value       = module.cognito.user_pool_client_id
}

output "cognito_domain" {
  description = "Fully-qualified Cognito hosted-UI domain."
  value       = module.cognito.domain
}

output "cognito_hosted_ui_login_url" {
  description = "Drop-in login URL. Click it to hit Cognito's hosted UI."
  value       = module.cognito.hosted_ui_login_url
}

output "cognito_hosted_ui_signup_url" {
  description = "Drop-in signup URL. Judges register here, set TOTP, then land on the site."
  value       = module.cognito.hosted_ui_signup_url
}

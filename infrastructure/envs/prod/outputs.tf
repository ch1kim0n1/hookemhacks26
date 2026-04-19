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

output "site_custom_url" {
  description = "Public URL via the custom domain (null when site_domain_name is empty)."
  value       = var.site_domain_name != "" ? "https://${var.site_domain_name}/" : null
}

output "dns_zone_id" {
  description = "Route53 hosted zone id (null when site_domain_name is empty)."
  value       = var.site_domain_name != "" ? module.dns[0].zone_id : null
}

output "dns_name_servers" {
  description = <<-EOT
    Nameservers to paste into GoDaddy for the managed domain. Four entries.
    Null when site_domain_name is empty.
  EOT
  value = var.site_domain_name != "" ? module.dns[0].name_servers : null
}

output "dns_certificate_arn" {
  description = "ACM cert ARN in us-east-1 that CloudFront is using (null when site_domain_name is empty)."
  value       = var.site_domain_name != "" ? module.dns[0].certificate_arn : null
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

# ---------------------------------------------------------------------------
# Pillar 2 outputs — KMS + Secrets + Bedrock + API + (optional) compute
# ---------------------------------------------------------------------------

output "envelope_kms_key_arn" {
  description = "Envelope CMK ARN — encrypts Secrets Manager material at rest."
  value       = module.envelope_kms.key_arn
}

output "envelope_kms_alias" {
  description = "Envelope CMK alias (alias/clawguard-envelope)."
  value       = module.envelope_kms.alias
}

output "node_kms_key_ids" {
  description = "Map of { node_id => KMS signing key id } for each decentralised node."
  value       = { for k, n in module.node_signer : k => n.kms_key_id }
}

output "node_kms_key_arns" {
  description = "Map of { node_id => KMS signing key ARN }."
  value       = { for k, n in module.node_signer : k => n.kms_key_arn }
}

output "node_kms_aliases" {
  description = "Map of { node_id => KMS alias } (alias/clawguard-node-<id>)."
  value       = { for k, n in module.node_signer : k => n.kms_alias }
}

output "node_task_role_arns" {
  description = "Per-node ECS task role ARN (the node's AWS identity)."
  value       = { for k, n in module.node_signer : k => n.task_role_arn }
}

output "secret_arns" {
  description = "Map of { short_name => Secrets Manager secret ARN } for every rotating token."
  value       = module.secrets.secret_arns
}

output "bedrock_policy_arn" {
  description = "Managed policy for bedrock:InvokeModel on Claude Haiku 4.5."
  value       = module.bedrock.policy_arn
}

output "api_endpoint" {
  description = "Invoke base URL for the ClawGuard signer + detector API (IAM-auth)."
  value       = module.api_gateway.api_endpoint
}

output "api_execute_arn" {
  description = "Base execution ARN for the API (use for wildcard IAM resource blocks)."
  value       = module.api_gateway.execute_arn
}

output "rotation_lambda_arn" {
  description = "Lambda that rotates Secrets Manager entries on a 30-day cadence."
  value       = module.rotation_lambda.function_arn
}

output "alerts_topic_arn" {
  description = "SNS topic for CloudWatch alarm notifications."
  value       = module.observability.alerts_topic_arn
}

output "node_ecr_repository_url" {
  description = "ECR repo URL the node container image is pushed to (null when compute is disabled)."
  value       = var.enable_compute ? module.nodes[0].ecr_repository_url : null
}

output "node_ecs_cluster_name" {
  description = "ECS cluster running the three node services (null when compute is disabled)."
  value       = var.enable_compute ? module.nodes[0].cluster_name : null
}

output "node_service_names" {
  description = "Map of { node_id => ECS service name } when compute is enabled."
  value       = var.enable_compute ? module.nodes[0].service_names : {}
}

module "preflight" {
  source = "../../modules/preflight"

  check_bedrock = var.check_bedrock
}

locals {
  # Global-unique S3 bucket name. We don't want the operator to own uniqueness;
  # account id is the simplest suffix that guarantees it.
  site_bucket_name = "${var.site_name}-${module.preflight.account_id}"

  has_managed_domain = var.site_domain_name != ""

  # Distribution aliases default to [apex, www.apex] when a domain is set; the
  # operator can still add extras via var.site_aliases.
  site_aliases_effective = local.has_managed_domain ? distinct(concat(
    [var.site_domain_name, "www.${var.site_domain_name}"],
    var.site_aliases,
  )) : var.site_aliases

  # Prefer the dns-module cert unless the operator hard-overrides.
  site_acm_certificate_arn_effective = coalesce(
    var.site_acm_certificate_arn,
    local.has_managed_domain ? module.dns[0].certificate_arn : null,
  )
}

module "dns" {
  source = "../../modules/dns"
  count  = local.has_managed_domain ? 1 : 0

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  domain_name = var.site_domain_name

  tags = { Env = "prod" }
}

# Apex + www ALIAS records pointing at CloudFront. Kept in root (not in the
# dns module) to avoid a module-level cycle: site.cert_arn <- dns.cert, and
# these records depend on site.distribution_*.
resource "aws_route53_record" "site_apex" {
  count = local.has_managed_domain && var.dns_create_alias_records ? 1 : 0

  zone_id = module.dns[0].zone_id
  name    = var.site_domain_name
  type    = "A"

  alias {
    name                   = module.site.distribution_domain_name
    zone_id                = module.site.distribution_hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "site_apex_aaaa" {
  count = local.has_managed_domain && var.dns_create_alias_records ? 1 : 0

  zone_id = module.dns[0].zone_id
  name    = var.site_domain_name
  type    = "AAAA"

  alias {
    name                   = module.site.distribution_domain_name
    zone_id                = module.site.distribution_hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "site_www" {
  count = local.has_managed_domain && var.dns_create_alias_records ? 1 : 0

  zone_id = module.dns[0].zone_id
  name    = "www.${var.site_domain_name}"
  type    = "A"

  alias {
    name                   = module.site.distribution_domain_name
    zone_id                = module.site.distribution_hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "site_www_aaaa" {
  count = local.has_managed_domain && var.dns_create_alias_records ? 1 : 0

  zone_id = module.dns[0].zone_id
  name    = "www.${var.site_domain_name}"
  type    = "AAAA"

  alias {
    name                   = module.site.distribution_domain_name
    zone_id                = module.site.distribution_hosted_zone_id
    evaluate_target_health = false
  }
}

module "site" {
  source = "../../modules/static-site"

  name                        = var.site_name
  bucket_name                 = local.site_bucket_name
  additional_html_entrypoints = var.site_additional_html_entrypoints
  aliases                     = local.site_aliases_effective
  acm_certificate_arn         = local.site_acm_certificate_arn_effective

  tags = {
    Env = "prod"
  }
}

locals {
  cognito_domain_prefix = var.cognito_domain_prefix != "" ? var.cognito_domain_prefix : "clawguard-${module.preflight.account_id}"

  # CloudFront always serves over https; the trailing slash matches Cognito's
  # redirect_uri exact-match semantics.
  site_callback_url = "https://${module.site.distribution_domain_name}/"
}

module "cognito" {
  source = "../../modules/cognito"

  name          = var.cognito_name
  domain_prefix = local.cognito_domain_prefix
  callback_urls = concat([local.site_callback_url], var.cognito_extra_callback_urls)
  logout_urls   = concat([local.site_callback_url], var.cognito_extra_callback_urls)
  mfa_required  = var.cognito_mfa_required

  tags = {
    Env = "prod"
  }
}

# ---------------------------------------------------------------------------
# Pillar 2 — security primitives
# ---------------------------------------------------------------------------

module "envelope_kms" {
  source = "../../modules/envelope-kms"

  name = "${var.project}-envelope"

  # The key policy grants kms:* to the account root, which per AWS convention
  # delegates authorisation to IAM. Node task roles and the Lambda exec roles
  # grant themselves kms:Encrypt/Decrypt on this ARN in their own inline
  # policies; leaving grantee_arns empty avoids a TF cycle with node_signer.

  tags = { Env = "prod" }
}

module "bedrock" {
  source = "../../modules/bedrock"

  name = "${var.project}-bedrock"

  tags = { Env = "prod" }
}

module "node_signer" {
  source   = "../../modules/node-signer"
  for_each = toset(var.node_ids)

  name    = "${var.project}-node"
  node_id = each.value

  readable_secret_arns = module.secrets.secret_arns_list
  envelope_kms_arn     = module.envelope_kms.key_arn
  attached_policy_arns = [module.bedrock.policy_arn]

  # Wildcard on execute-api to avoid a TF cycle with api_gateway. Blast radius
  # is bounded by the fact that every route on the API requires AWS_IAM auth
  # *and* the target Lambda performs its own authorisation on KMS keys.
  api_execute_arns = ["arn:aws:execute-api:${var.aws_region}:*:*"]

  tags = { Env = "prod" }
}

module "rotation_lambda" {
  source = "../../modules/rotation-lambda"

  name = "${var.project}-rotate-token"

  secret_name_prefix = var.project
  kms_key_arns       = [module.envelope_kms.key_arn]

  tags = { Env = "prod" }
}

module "secrets" {
  source = "../../modules/secrets"

  name_prefix         = var.project
  kms_key_arn         = module.envelope_kms.key_arn
  rotation_lambda_arn = module.rotation_lambda.function_arn
  rotation_days       = var.rotation_days

  tags = { Env = "prod" }
}

module "api_gateway" {
  source = "../../modules/api-gateway"

  name                  = "${var.project}-api"
  node_signing_key_arns = [for n in module.node_signer : n.kms_key_arn]
  node_alias_prefix     = "${var.project}-node"
  bedrock_policy_arn    = module.bedrock.policy_arn

  tags = { Env = "prod" }
}

# ---------------------------------------------------------------------------
# Pillar 2 — compute (optional, cost-gated)
# ---------------------------------------------------------------------------

module "network" {
  count  = var.enable_compute ? 1 : 0
  source = "../../modules/network"

  name = "${var.project}-net"

  tags = { Env = "prod" }
}

module "nodes" {
  count  = var.enable_compute ? 1 : 0
  source = "../../modules/nodes"

  name = "${var.project}-nodes"

  nodes = {
    for id in var.node_ids : id => {
      task_role_arn = module.node_signer[id].task_role_arn
      kms_key_arn   = module.node_signer[id].kms_key_arn
    }
  }

  container_image      = var.node_container_image
  api_endpoint         = module.api_gateway.api_endpoint
  bedrock_model_id     = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
  registry_address     = var.registry_address
  base_sepolia_rpc_url = var.base_sepolia_rpc_url

  private_subnet_ids     = module.network[0].private_subnet_ids
  task_security_group_id = module.network[0].task_security_group_id
  envelope_kms_arn       = module.envelope_kms.key_arn

  readable_secret_arns = module.secrets.secret_arns_list
  secret_refs = {
    CLAWGUARD_ADMIN_TOKEN   = module.secrets.secret_arns["admin-token"]
    CLAWGUARD_METRICS_TOKEN = module.secrets.secret_arns["metrics-token"]
    CLAWGUARD_WS_TOKEN      = module.secrets.secret_arns["ws-token"]
  }

  tags = { Env = "prod" }
}

module "observability" {
  source = "../../modules/observability"

  name         = "${var.project}-obs"
  alert_emails = var.alert_emails

  sign_tx_log_group     = module.api_gateway.sign_tx_log_group
  detect_log_group      = module.api_gateway.detect_log_group
  sign_tx_function_name = module.api_gateway.sign_tx_function_name

  tags = { Env = "prod" }
}

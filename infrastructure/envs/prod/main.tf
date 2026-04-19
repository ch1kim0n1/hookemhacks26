module "preflight" {
  source = "../../modules/preflight"

  check_bedrock = var.check_bedrock
}

locals {
  # Global-unique S3 bucket name. We don't want the operator to own uniqueness;
  # account id is the simplest suffix that guarantees it.
  site_bucket_name = "${var.site_name}-${module.preflight.account_id}"
}

module "site" {
  source = "../../modules/static-site"

  name                        = var.site_name
  bucket_name                 = local.site_bucket_name
  additional_html_entrypoints = var.site_additional_html_entrypoints
  aliases                     = var.site_aliases
  acm_certificate_arn         = var.site_acm_certificate_arn

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

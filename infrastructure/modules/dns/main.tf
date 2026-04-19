terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source                = "hashicorp/aws"
      version               = "~> 5.60"
      configuration_aliases = [aws.us_east_1]
    }
  }
}

locals {
  www_name = "www.${var.domain_name}"
  tags     = merge({ Component = "dns" }, var.tags)
}

# ---------------------------------------------------------------------------
# Route53 hosted zone. NS delegation must be pasted into the registrar
# (GoDaddy for clawguardian.ink) once on first apply.
# ---------------------------------------------------------------------------

resource "aws_route53_zone" "this" {
  name    = var.domain_name
  comment = "Managed by Terraform — clawguard"
  tags    = local.tags
}

# ---------------------------------------------------------------------------
# ACM certificate in us-east-1 (CloudFront requirement). DNS-validated.
# SAN covers apex + www.
# ---------------------------------------------------------------------------

resource "aws_acm_certificate" "this" {
  provider = aws.us_east_1

  domain_name               = var.domain_name
  subject_alternative_names = [local.www_name]
  validation_method         = "DNS"
  tags                      = local.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.this.domain_validation_options :
    dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id         = aws_route53_zone.this.zone_id
  name            = each.value.name
  type            = each.value.type
  ttl             = 60
  records         = [each.value.record]
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "this" {
  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.this.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]

  timeouts {
    create = "60m"
  }
}

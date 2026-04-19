output "zone_id" {
  description = "Route53 hosted zone id."
  value       = aws_route53_zone.this.zone_id
}

output "name_servers" {
  description = "NS records to copy into the registrar (GoDaddy). Four entries."
  value       = aws_route53_zone.this.name_servers
}

output "certificate_arn" {
  description = "Validated ACM cert ARN in us-east-1. Wire into CloudFront viewer_certificate."
  value       = aws_acm_certificate_validation.this.certificate_arn
}

output "domain_name" {
  description = "Apex domain managed by this module."
  value       = var.domain_name
}

output "www_name" {
  description = "www subdomain managed by this module."
  value       = local.www_name
}

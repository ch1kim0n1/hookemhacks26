output "bucket_name" {
  description = "Name of the S3 bucket holding site content."
  value       = aws_s3_bucket.site.bucket
}

output "bucket_arn" {
  description = "ARN of the S3 bucket."
  value       = aws_s3_bucket.site.arn
}

output "distribution_id" {
  description = "CloudFront distribution id. Needed for invalidations."
  value       = aws_cloudfront_distribution.site.id
}

output "distribution_arn" {
  description = "CloudFront distribution ARN."
  value       = aws_cloudfront_distribution.site.arn
}

output "distribution_domain_name" {
  description = "Default *.cloudfront.net hostname."
  value       = aws_cloudfront_distribution.site.domain_name
}

output "distribution_hosted_zone_id" {
  description = "Zone id for Route53 ALIAS records pointing at the distribution."
  value       = aws_cloudfront_distribution.site.hosted_zone_id
}

output "oac_id" {
  description = "Origin Access Control id."
  value       = aws_cloudfront_origin_access_control.site.id
}

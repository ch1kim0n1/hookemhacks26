# modules/static-site

Private S3 bucket + CloudFront distribution + Origin Access Control.

## Shape

- S3 bucket: private (all public access blocked), SSE-S3, versioned, TLS-only bucket policy, `BucketOwnerEnforced` ownership.
- CloudFront: OAC-based origin, `redirect-to-https` viewer policy, HTTP/2 + HTTP/3, AWS-managed `CachingOptimized` cache policy, gzip/br compression.
- No WAF. No logging bucket. Intentionally simple.

## Adding a custom domain

```hcl
module "site" {
  source               = "../../modules/static-site"
  name                 = "clawguard-landing"
  bucket_name          = "clawguard-landing-123456789012"
  aliases              = ["example.com", "www.example.com"]
  acm_certificate_arn  = "arn:aws:acm:us-east-1:123456789012:certificate/abc"
}
```

Then point Route53 at `distribution_domain_name` with an ALIAS record using `distribution_hosted_zone_id`.

## SPA-ish deep links

If you serve more than just `/`, pass the extra HTML entrypoints so CloudFront rewrites 403s back to the right file:

```hcl
additional_html_entrypoints = ["dashboard.html"]
```

A request to `/dashboard` would normally 403 (no such S3 key); CloudFront will rewrite that to `/dashboard.html` with a 200.

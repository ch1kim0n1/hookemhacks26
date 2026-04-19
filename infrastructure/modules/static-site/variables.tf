variable "name" {
  description = "Logical name of the site. Used as a prefix for every resource and as a Name tag."
  type        = string
}

variable "bucket_name" {
  description = <<-EOT
    S3 bucket name for site content. Must be globally unique. We append the account id
    in the caller to keep it unique across AWS without requiring the operator to pick
    a unique string.
  EOT
  type        = string
}

variable "default_root_object" {
  description = "CloudFront default root object (served for requests to `/`)."
  type        = string
  default     = "index.html"
}

variable "additional_html_entrypoints" {
  description = <<-EOT
    Extra top-level HTML files (besides the default root) that CloudFront should
    serve as custom error responses for 403/404. The frontend currently ships
    `index.html` and `dashboard.html`; listing them here lets deep links like
    `/dashboard` resolve without an SPA router in the way.
  EOT
  type        = list(string)
  default     = []
}

variable "price_class" {
  description = "CloudFront price class. 100 = US/EU only (cheapest), 200 = + ME/Asia, All = global."
  type        = string
  default     = "PriceClass_100"

  validation {
    condition     = contains(["PriceClass_100", "PriceClass_200", "PriceClass_All"], var.price_class)
    error_message = "price_class must be PriceClass_100, PriceClass_200, or PriceClass_All."
  }
}

variable "aliases" {
  description = <<-EOT
    Optional list of custom domain names to attach to the distribution. Leave empty
    to use only the default *.cloudfront.net hostname. When set, you MUST also
    provide acm_certificate_arn for a cert in us-east-1 covering these names.
  EOT
  type        = list(string)
  default     = []
}

variable "acm_certificate_arn" {
  description = "ARN of an ACM certificate in us-east-1 covering `aliases`. Required when aliases is non-empty."
  type        = string
  default     = null

  validation {
    condition     = var.acm_certificate_arn == null || can(regex("^arn:aws:acm:us-east-1:", var.acm_certificate_arn))
    error_message = "CloudFront requires the ACM certificate to be in us-east-1."
  }
}

variable "minimum_protocol_version" {
  description = "Minimum TLS version when using a custom cert. Ignored when no aliases are set."
  type        = string
  default     = "TLSv1.2_2021"
}

variable "tags" {
  description = "Additional tags merged onto every resource."
  type        = map(string)
  default     = {}
}

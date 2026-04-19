terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}

locals {
  tags = merge({ Component = var.name }, var.tags)
}

resource "aws_cognito_user_pool" "this" {
  name = var.name
  tags = local.tags

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  # TOTP MFA — simpler than SMS, no SNS setup, no per-message cost. Users scan a
  # QR code in an authenticator app. When required, every sign-in prompts for a
  # code after password.
  mfa_configuration = var.mfa_required ? "ON" : "OPTIONAL"

  software_token_mfa_configuration {
    enabled = true
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 3
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  admin_create_user_config {
    # Self-signup is on so judges can register without us provisioning them.
    allow_admin_create_user_only = false
  }

  email_configuration {
    # Cognito's default sender (50/day, sandboxed). Fine for a demo; swap to SES later.
    email_sending_account = "COGNITO_DEFAULT"
  }

  # Cognito treats pool deletion protection as opt-in. We want the demo to be
  # destroyable with `terraform destroy`, so leave it OFF.
  deletion_protection = "INACTIVE"
}

resource "aws_cognito_user_pool_domain" "this" {
  domain       = var.domain_prefix
  user_pool_id = aws_cognito_user_pool.this.id
}

resource "aws_cognito_user_pool_client" "this" {
  name         = "${var.name}-web"
  user_pool_id = aws_cognito_user_pool.this.id

  # Public SPA client — no secret. The PKCE-based Authorization Code flow is the
  # supported pattern for browser apps.
  generate_secret = false

  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["email", "openid", "profile"]
  allowed_oauth_flows_user_pool_client = true
  supported_identity_providers         = ["COGNITO"]

  callback_urls = var.callback_urls
  logout_urls   = var.logout_urls

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  # Don't leak whether a given email is registered on failed auth.
  prevent_user_existence_errors = "ENABLED"
}

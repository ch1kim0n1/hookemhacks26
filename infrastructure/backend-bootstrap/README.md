# backend-bootstrap

One-time root module that creates the S3 bucket and DynamoDB lock table used as
the Terraform backend by `envs/prod`.

**Uses LOCAL state**, because the state bucket can't hold its own state. That
tfstate file describes only the backend itself and contains nothing sensitive,
but it is gitignored by default — keep a copy somewhere safe if multiple people
need to manage the backend.

```bash
cd infrastructure/backend-bootstrap
terraform init
terraform apply

# Copy these into envs/prod/backend.hcl:
terraform output
```

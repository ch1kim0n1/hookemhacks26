output "state_bucket_name" {
  description = "Name of the S3 bucket holding Terraform state. Plug into envs/*/backend.hcl as `bucket = ...`."
  value       = aws_s3_bucket.tf_state.bucket
}

output "lock_table_name" {
  description = "DynamoDB table used for state locking. Plug into envs/*/backend.hcl as `dynamodb_table = ...`."
  value       = aws_dynamodb_table.tf_lock.name
}

output "region" {
  description = "Region the state bucket lives in."
  value       = var.aws_region
}

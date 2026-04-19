output "cluster_name" {
  description = "ECS cluster name."
  value       = aws_ecs_cluster.this.name
}

output "cluster_arn" {
  description = "ECS cluster ARN."
  value       = aws_ecs_cluster.this.arn
}

output "ecr_repository_url" {
  description = "ECR repo URL — push images here."
  value       = aws_ecr_repository.node.repository_url
}

output "ecr_repository_arn" {
  description = "ECR repo ARN."
  value       = aws_ecr_repository.node.arn
}

output "service_names" {
  description = "Map of { node_id => ECS service name }."
  value       = { for k, s in aws_ecs_service.node : k => s.name }
}

output "task_definition_arns" {
  description = "Map of { node_id => task definition ARN }."
  value       = { for k, td in aws_ecs_task_definition.node : k => td.arn }
}

output "log_group_names" {
  description = "Map of { node_id => CloudWatch log group name }."
  value       = { for k, lg in aws_cloudwatch_log_group.node : k => lg.name }
}

output "exec_role_arn" {
  description = "Shared execution-role ARN."
  value       = aws_iam_role.exec.arn
}

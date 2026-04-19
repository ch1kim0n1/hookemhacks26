output "alb_dns_name" {
  description = "ALB DNS — use as VITE_API_BASE_URL prefix in frontend build."
  value       = aws_lb.this.dns_name
}

output "alb_zone_id" {
  description = "ALB hosted zone id (for Route53 alias if needed later)."
  value       = aws_lb.this.zone_id
}

output "cluster_name" {
  description = "ECS cluster name."
  value       = aws_ecs_cluster.this.name
}

output "node_endpoints" {
  description = "Map of node_id => public URL."
  value = {
    for k, _ in var.nodes :
    k => "http://${aws_lb.this.dns_name}/n/${k}"
  }
}

output "topology_json" {
  description = "The mesh topology JSON baked into every task."
  value       = local.topology_json
}

output "log_group_names" {
  description = "Per-node CloudWatch log group names."
  value       = { for k, lg in aws_cloudwatch_log_group.node : k => lg.name }
}

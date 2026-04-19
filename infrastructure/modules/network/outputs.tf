output "vpc_id" {
  description = "VPC id."
  value       = aws_vpc.this.id
}

output "private_subnet_ids" {
  description = "Private subnet IDs. Wire Fargate services and Lambda VPC config here."
  value       = aws_subnet.private[*].id
}

output "public_subnet_ids" {
  description = "Public subnet IDs (hold the NAT)."
  value       = aws_subnet.public[*].id
}

output "task_security_group_id" {
  description = "Security group for Fargate tasks (egress-only, HTTPS)."
  value       = aws_security_group.task.id
}

output "endpoint_security_group_id" {
  description = "Security group attached to the VPC interface endpoints."
  value       = aws_security_group.endpoint.id
}

output "nat_public_ip" {
  description = "EIP of the NAT — stable source IP for chain RPC egress."
  value       = aws_eip.nat.public_ip
}

output "vpc_endpoint_ids" {
  description = "Map of { service => endpoint_id } for interface endpoints."
  value       = { for k, e in aws_vpc_endpoint.interface : k => e.id }
}

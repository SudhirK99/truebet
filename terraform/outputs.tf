output "load_balancer_dns" {
  value       = aws_lb.app_lb.dns_name
  description = "The DNS name of the load balancer"
}

output "vpc_id" {
  value       = aws_vpc.main.id
  description = "The ID of the VPC"
}

output "public_subnets" {
  value       = aws_subnet.public[*].id
  description = "The IDs of the public subnets"
}

output "ecs_cluster_name" {
  value       = aws_ecs_cluster.main.name
  description = "The name of the ECS cluster"
}

output "cloudwatch_log_group" {
  value       = aws_cloudwatch_log_group.ecs_logs.name
  description = "The name of the CloudWatch log group"
}

output "ecr_repository_url" {
  value       = "${aws_ecr_repository.app.repository_url}"
  description = "The URL of the ECR repository"
}

output "nat_gateway_ip" {
  value       = aws_eip.nat.public_ip
  description = "The public IP address of the NAT Gateway"
}
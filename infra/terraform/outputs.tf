output "alb_dns_name" {
  description = "Point Route 53 A/ALIAS records for both domains at this."
  value       = aws_lb.main.dns_name
}

output "ecr_api_repository_url" {
  value = aws_ecr_repository.api.repository_url
}

output "ecr_web_repository_url" {
  value = aws_ecr_repository.web.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "app_secret_arn" {
  description = "Add JWT/gateway/FCM/Sentry keys to this secret out of band."
  value       = aws_secretsmanager_secret.app.arn
}

output "db_endpoint" {
  value     = aws_db_instance.postgres.address
  sensitive = true
}

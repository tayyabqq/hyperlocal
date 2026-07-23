# Application secrets live in Secrets Manager (Technology doc: "AWS Secrets
# Manager (production)"), never in the task definition or image. The ECS task
# execution role is granted read on exactly these ARNs.
#
# DATABASE_URL and REDIS_URL are composed from the managed resources and stored
# here so the task definition references a single secret source.

resource "aws_secretsmanager_secret" "app" {
  name                    = "hyperlocal/${var.environment}/app"
  description             = "Runtime secrets for the Hyperlocal API"
  recovery_window_in_days = 7
}

locals {
  database_url = "postgresql://hl:${random_password.db.result}@${aws_db_instance.postgres.address}:5432/hl"
  redis_url    = "redis://${aws_elasticache_replication_group.redis.primary_endpoint_address}:6379"
}

# The non-secret-derived values (JWT keys, gateway keys, FCM JSON, Sentry DSN)
# are seeded once by an operator via the AWS console / CLI, then referenced here.
# Terraform manages the DB/Redis-derived pair and leaves the rest for rotation
# outside state so long-lived credentials never land in the plan output.
resource "aws_secretsmanager_secret_version" "connection_strings" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    DATABASE_URL = local.database_url
    REDIS_URL    = local.redis_url
  })

  lifecycle {
    # An operator adds JWT/gateway/FCM keys to the same secret out of band; do
    # not let a plan clobber them back to just the two connection strings.
    ignore_changes = [secret_string]
  }
}

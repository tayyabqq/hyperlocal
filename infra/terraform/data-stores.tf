# Managed Postgres with PostGIS. Single instance now, scaled vertically then to
# read replicas per the scalability roadmap. All data stays in me-central-1.
resource "aws_db_subnet_group" "main" {
  name       = "hyperlocal-${var.environment}"
  subnet_ids = module.vpc.private_subnets
}

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_db_instance" "postgres" {
  identifier     = "hyperlocal-${var.environment}"
  engine         = "postgres"
  engine_version = "16.4"
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_allocated_storage * 5 # storage autoscaling headroom
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "hl"
  username = "hl"
  password = random_password.db.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.data.id]
  multi_az               = true # payments require durability; the doc calls for Multi-AZ at scale

  backup_retention_period    = 7
  auto_minor_version_upgrade = true
  deletion_protection        = true
  skip_final_snapshot        = false
  final_snapshot_identifier  = "hyperlocal-${var.environment}-final"

  # PostGIS ships in the RDS postgres image; the migration runner does
  # CREATE EXTENSION IF NOT EXISTS postgis on first migrate.
}

# Redis for hot geo cache, chat presence/fan-out, rate limiting, session state.
resource "aws_elasticache_subnet_group" "main" {
  name       = "hyperlocal-${var.environment}"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "hyperlocal-${var.environment}"
  description          = "Hyperlocal cache + chat fan-out"
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = var.redis_node_type
  num_cache_clusters   = 2 # primary + replica for failover
  automatic_failover_enabled = true

  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [aws_security_group.data.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = false # in-VPC only; enable + auth token if this changes
}

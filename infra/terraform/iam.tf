# Execution role: what ECS itself needs (pull images, write logs, read secrets).
resource "aws_iam_role" "task_execution" {
  name = "hyperlocal-${var.environment}-task-exec"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "task_execution" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Read only the app secret — nothing broader.
resource "aws_iam_role_policy" "secrets_read" {
  name = "read-app-secret"
  role = aws_iam_role.task_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [aws_secretsmanager_secret.app.arn]
    }]
  })
}

# Task role: what the application code is allowed to do at runtime. The API talks
# only to RDS/Redis (network-scoped) and outbound HTTPS, so it needs no AWS API
# permissions of its own today. Kept as a distinct role so grants stay minimal
# and auditable if that changes.
resource "aws_iam_role" "task" {
  name = "hyperlocal-${var.environment}-task"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

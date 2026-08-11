resource "aws_ecs_cluster" "main" {
  name = "hyperlocal-${var.environment}"
  setting {
    name  = "containerInsights"
    value = "enabled" # CloudWatch Container Insights for infra metrics
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/hyperlocal-${var.environment}/api"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/hyperlocal-${var.environment}/web"
  retention_in_days = 30
}

locals {
  # Secrets injected from Secrets Manager by key. Non-connection secrets
  # (JWT keys, gateway keys, FCM JSON, Sentry DSN) are added to the same secret
  # by an operator and referenced the same way.
  api_secrets = [
    for k in [
      "DATABASE_URL", "REDIS_URL", "JWT_PRIVATE_KEY", "JWT_PUBLIC_KEY",
      "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_AUTH_TEMPLATE_NAME", "WHATSAPP_TEMPLATE_LANGUAGE",
      "PAYTABS_PROFILE_ID", "PAYTABS_SERVER_KEY",
      "FCM_PROJECT_ID", "FCM_SERVICE_ACCOUNT_JSON", "SENTRY_DSN",
    ] : {
      name      = k
      valueFrom = "${aws_secretsmanager_secret.app.arn}:${k}::"
    }
  ]
}

# --- API service ---
resource "aws_ecs_task_definition" "api" {
  family                   = "hyperlocal-${var.environment}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name      = "api"
    image     = var.api_image
    essential = true
    portMappings = [{ containerPort = 3000 }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = "3000" },
      { name = "OTP_PROVIDER", value = "whatsapp" },
      { name = "PAYMENT_GATEWAY", value = "paytabs" },
      { name = "PUSH_PROVIDER", value = "fcm" },
      { name = "PAYTABS_BASE_URL", value = "https://secure.paytabs.com" },
      { name = "PAYMENT_RETURN_URL", value = "https://${var.domain_name}/listings/pending" },
      { name = "PAYMENT_CALLBACK_URL", value = "https://${var.api_domain_name}/v1/payments/callback" },
      { name = "API_PUBLIC_URL", value = "https://${var.api_domain_name}" },
      { name = "CORS_ORIGINS", value = "https://${var.domain_name}" },
      { name = "LAUNCH_FREE_LISTING_CREDITS", value = "1" },
      { name = "WEEKLY_LISTING_LIMIT", value = "20" },
    ]
    secrets = local.api_secrets
    healthCheck = {
      command     = ["CMD-SHELL", "node -e \"fetch('http://localhost:3000/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 20
    }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.api.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "api"
      }
    }
  }])
}

resource "aws_ecs_service" "api" {
  name            = "api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.api_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = module.vpc.private_subnets
    security_groups = [aws_security_group.ecs.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3000
  }

  # Sticky sessions matter for the chat WebSocket handshake; the Redis adapter
  # handles cross-instance fan-out so stickiness is an optimisation, not a
  # correctness requirement.
  depends_on = [aws_lb_listener.https]
}

# --- Web service ---
resource "aws_ecs_task_definition" "web" {
  family                   = "hyperlocal-${var.environment}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name      = "web"
    image     = var.web_image
    essential = true
    portMappings = [{ containerPort = 3001 }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = "3001" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.web.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "web"
      }
    }
  }])
}

resource "aws_ecs_service" "web" {
  name            = "web"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = var.web_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = module.vpc.private_subnets
    security_groups = [aws_security_group.ecs.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3001
  }

  depends_on = [aws_lb_listener.https]
}

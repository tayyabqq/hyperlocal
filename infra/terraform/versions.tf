terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State lives in S3 with a DynamoDB lock table, both in me-central-1 to keep
  # all project data in-region (UAE data residency is a business constraint, not
  # a preference — Technology doc). Create these once, out of band, then run
  # `terraform init`.
  backend "s3" {
    bucket         = "hyperlocal-tfstate"
    key            = "prod/terraform.tfstate"
    region         = "me-central-1"
    dynamodb_table = "hyperlocal-tflock"
    encrypt        = true
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "hyperlocal"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

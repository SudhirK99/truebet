provider "aws" {
  region = var.aws_region
  
  # Use either AWS CLI profile or access keys
  # profile = "default"
  # access_key = "YOUR_AWS_ACCESS_KEY"
  # secret_key = "YOUR_AWS_SECRET_KEY"
}

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  required_version = ">= 1.0"
}
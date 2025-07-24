variable "environment_variable_names" {
  description = "Names of environment variables"
  type        = set(string)
  default     = [
    "API_PASSWORD",
    "API_SALT",
    "API_USERNAME",
    "JWT_SECRET",
    "CLIENT_USER_NAME",
    "CLIENT_PASSWORD",
    "CMS_TOKEN_BASE_URL",
    "CMS_USER_BASE_URL",
    "MONGO_URI",
    "PROVIDER_API_URL",
    "SOCKET_CORS_ORIGINS",
    "CORS_ORIGINS",
    "DECRYPTION_PRIVATE_KEY",
    "CPYPRAGMATIC_API_ENDPONIT",
    "CPYPRAGMATIC_API_TOKEN",
    "CPYPRAGMATIC_SECRET_KEY",
    # Add more variable names here
  ]
}

variable "environment_variable_values" {
  description = "Values for environment variables (sensitive)"
  type        = map(string)
  sensitive   = true
}

variable "project_name" {
  description = "Name of the project"
  type        = string
  default     = "truebet-app"
}

variable "environment" {
  description = "Environment (dev/staging/prod)"
  type        = string
  default     = "prod"
}

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "aws_region" {
  description = "AWS Region"
  type        = string
  default     = "us-west-2"
}

data "aws_availability_zones" "available" {
  state = "available"
}

variable "domain_name" {
  description = "Domain name for the application"
  type        = string
}
# Create SSM parameters for environment variables
resource "aws_ssm_parameter" "app_parameters" {
  for_each = var.environment_variable_names

  name  = "/${var.project_name}/${each.key}"
  type  = "SecureString"
  value = var.environment_variable_values[each.key]

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}

# IAM policy for accessing parameters
resource "aws_iam_role_policy" "ecs_task_execution_role_policy_ssm" {
  name = "${var.project_name}-ssm-policy"
  role = aws_iam_role.ecs_task_execution_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameters",
          "secretsmanager:GetSecretValue",
          "kms:Decrypt"
        ]
        Resource = [
          "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/${var.project_name}/*"
        ]
      }
    ]
  })
}

# Get current AWS account ID
data "aws_caller_identity" "current" {}
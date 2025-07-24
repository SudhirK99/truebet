# Express.js AWS ECS Deployment

This repository contains Terraform configurations and GitHub Actions workflow for deploying an Express.js application to AWS ECS using Fargate.

## Architecture

- **VPC** with public subnets across multiple availability zones
- **ECS Fargate** for container orchestration
- **Application Load Balancer** for traffic distribution
- **ECR** for container image storage
- **CloudWatch** for logging
- **AWS Systems Manager Parameter Store** for secrets management

## Prerequisites

1. AWS Account with appropriate permissions
2. GitHub repository
3. Terraform installed locally
4. AWS CLI installed and configured
5. Docker installed locally
6. MongoDB Atlas account (or other MongoDB provider)

## Directory Structure

```
your-project/
├── .github/
│   └── workflows/
│       └── deploy.yml
├── terraform/
│   ├── main.tf
│   ├── ecs.tf
│   ├── ssm.tf
│   ├── variables.tf
│   ├── outputs.tf
│   ├── provider.tf
│   └── backend.tf
├── src/
│   └── ... (your Express.js application files)
├── Dockerfile
├── task-definition.json
└── .dockerignore
```

## Setup Instructions

### 1. Configure AWS Credentials

```bash
aws configure
```

### 2. Set up Terraform Backend

Create an S3 bucket and DynamoDB table for Terraform state:

```bash
# Create S3 bucket
aws s3api create-bucket \
    --bucket truebet-state-bucket \
    --region us-west-2 \
    --create-bucket-configuration LocationConstraint=us-west-2

# http://truebet-state-bucket.s3.amazonaws.com/

# Enable versioning
aws s3api put-bucket-versioning \
    --bucket truebet-state-bucket \
    --versioning-configuration Status=Enabled

# Create DynamoDB table
aws dynamodb create-table \
    --table-name truebet-terraform-lock \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --provisioned-throughput ReadCapacityUnits=1,WriteCapacityUnits=1
```

### 3. Configure GitHub Secrets

Add these secrets to your GitHub repository:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`

### 4. Deploy Infrastructure

```bash
cd terraform
terraform init
terraform plan
terraform apply
```

### 5. Push Code to Trigger Deployment

```bash
git add .
git commit -m "Initial deployment"
git push origin main
```

## Environment Variables

Create a `terraform.tfvars` file:

```hcl
environment_variable_values = {
  "MONGODB_URI" = "your-mongodb-uri"
  "JWT_SECRET"  = "your-jwt-secret"
  "API_KEY"     = "your-api-key"
}

project_name = "your-app-name"
environment  = "prod"
```

## Accessing the Application

Get the ALB DNS name:
```bash
terraform output load_balancer_dns
```

Use this DNS name to access your application.

## Monitoring and Logs

- **Application Logs**: Available in CloudWatch Logs
  - Log Group: `/ecs/your-app-name`
  - Navigate to AWS CloudWatch → Log Groups

- **Health Checks**: Monitor in AWS Console
  - ECS Service Health: ECS → Clusters → Your Cluster → Services
  - Target Group Health: EC2 → Target Groups → Your Target Group

## Common Commands

```bash
# View logs
aws logs tail "/ecs/your-app-name" --follow

# Check ECS service status
aws ecs describe-services \
  --cluster your-app-name-cluster \
  --services your-app-name-service

# Check ALB target health
aws elbv2 describe-target-health \
  --target-group-arn $(terraform output -raw target_group_arn)
```

## Security Considerations

- All sensitive information is stored in AWS Systems Manager Parameter Store
- Services run in private subnets (if configured)
- Security groups restrict access to necessary ports only
- ECS tasks use execution roles with minimum required permissions

## Cleanup

To destroy all resources:
```bash
cd terraform
terraform destroy
```

## Troubleshooting

1. **Container Health Checks Failing**
   - Verify the `/health` endpoint in your Express application
   - Check CloudWatch logs for application errors

2. **Cannot Access Application**
   - Verify security group rules
   - Check ALB listener rules
   - Verify target group health

3. **Deployment Failures**
   - Check GitHub Actions logs
   - Verify ECS service events
   - Check CloudWatch logs

## License

[Add your license here]

## Contributing

[Add contribution guidelines here]
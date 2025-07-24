terraform {
  backend "s3" {
    bucket         = "truebet-state-bucket"    # Replace with your S3 bucket name
    key            = "truebet-app/terraform.tfstate"
    region         = "us-west-2"
    encrypt        = true
    dynamodb_table = "truebet-terraform-lock"                      # Replace with your DynamoDB table name
  }
}
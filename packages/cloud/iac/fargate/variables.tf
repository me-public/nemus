variable "region" {
  description = "AWS region to provision the Fargate target in."
  type        = string
  default     = "us-east-1"
}

variable "name" {
  description = "Name prefix for the cluster and related resources."
  type        = string
  default     = "nemus"
}

variable "vpc_id" {
  description = "VPC to run tasks in. Empty string uses the account's default VPC."
  type        = string
  default     = ""
}

variable "subnet_ids" {
  description = "Subnets for tasks. Empty list uses all subnets in the selected VPC."
  type        = list(string)
  default     = []
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention (days) for task logs."
  type        = number
  default     = 14
}

variable "tags" {
  description = "Extra tags applied to every resource."
  type        = map(string)
  default     = {}
}

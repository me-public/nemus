locals {
  tags = merge({
    "managed-by"      = "nemus"
    "nemus:component" = "cloud-runner"
  }, var.tags)
}

# --- Network: use the account's default VPC/subnets unless the caller overrides.
data "aws_vpc" "default" {
  count   = var.vpc_id == "" ? 1 : 0
  default = true
}

locals {
  vpc_id = var.vpc_id != "" ? var.vpc_id : data.aws_vpc.default[0].id
}

data "aws_subnets" "selected" {
  count = length(var.subnet_ids) == 0 ? 1 : 0
  filter {
    name   = "vpc-id"
    values = [local.vpc_id]
  }
}

locals {
  subnet_ids = length(var.subnet_ids) > 0 ? var.subnet_ids : data.aws_subnets.selected[0].ids
}

# --- Durable, provision-once resources. The per-run task definition + RunTask
#     are the Runner's job (fast, ephemeral); this module owns only what's slow
#     and stateful: the cluster, its log group, the task SG, and the exec role.
resource "aws_ecs_cluster" "this" {
  name = var.name
  tags = local.tags
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = ["FARGATE"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/nemus/${var.name}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

# Egress-only SG: tasks pull the image and reach the git forge; nothing inbound.
resource "aws_security_group" "task" {
  name_prefix = "${var.name}-task-"
  description = "Nemus Fargate task security group (egress only)"
  vpc_id      = local.vpc_id

  egress {
    description = "All egress"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.tags

  lifecycle {
    create_before_destroy = true
  }
}

# --- Task EXECUTION role: pull the image + write logs. The task ROLE (app
#     permissions) is deliberately omitted — the agent authenticates to the git
#     forge with a token from env, not cloud IAM, so it needs no AWS permissions.
data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name_prefix        = "${var.name}-exec-"
  assume_role_policy = data.aws_iam_policy_document.assume.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

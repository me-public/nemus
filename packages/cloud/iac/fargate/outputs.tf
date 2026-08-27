# The single output Nemus reads: a TargetDescriptor for the `aws-fargate` runner.
# The OpenTofuProvisioner maps `output.target.value` straight to a
# TargetDescriptor; provider-specific handles live under `extra`.
output "target" {
  description = "Nemus TargetDescriptor for the aws-fargate runner."
  value = {
    version = 1
    runner  = "aws-fargate"
    region  = var.region
    cluster = aws_ecs_cluster.this.name
    extra = {
      subnets            = local.subnet_ids
      security_group_id  = aws_security_group.task.id
      execution_role_arn = aws_iam_role.execution.arn
      log_group          = aws_cloudwatch_log_group.this.name
      # Handed back so `down` can re-derive the module's vars. (snake_case to
      # match the other extra handles; core reads target.extra.tofu_vars.)
      tofu_vars = {
        region = var.region
        name   = var.name
      }
    }
  }
}

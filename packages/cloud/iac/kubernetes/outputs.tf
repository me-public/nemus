# The single output Nemus reads: a TargetDescriptor for the `kubernetes` runner.
# The OpenTofuProvisioner maps `output.target.value` straight to a
# TargetDescriptor; runner-specific handles live under `extra` (snake_case, to
# match what KubernetesJobRunner reads: namespace / context / service_account /
# image_pull_secret).
output "target" {
  description = "Nemus TargetDescriptor for the kubernetes runner."
  value = {
    version = 1
    runner  = "kubernetes"
    extra = {
      namespace         = local.namespace
      context           = var.kube_context
      service_account   = kubernetes_service_account.this.metadata[0].name
      image_pull_secret = local.create_pull_secret ? kubernetes_secret.pull[0].metadata[0].name : ""
      # Handed back so `down` can re-derive the module's vars. (core reads
      # target.extra.tofu_vars.)
      tofu_vars = {
        name             = var.name
        namespace        = var.namespace
        create_namespace = var.create_namespace
        kube_config_path = var.kube_config_path
        kube_context     = var.kube_context
      }
    }
  }
}

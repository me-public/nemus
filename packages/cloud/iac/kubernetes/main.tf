locals {
  labels = merge({
    "managed-by"      = "nemus"
    "nemus/component" = "cloud-runner"
  }, var.labels)

  # Provision-once, durable resources only: the namespace, the run identity,
  # its (optional) pull secret and RBAC. The per-run Job + kubectl apply are the
  # Runner's job (fast, ephemeral) — this module owns only what's slow to stand
  # up and shared across runs.
  namespace = var.create_namespace ? kubernetes_namespace.this[0].metadata[0].name : var.namespace
  # Whether a pull secret was supplied is a boolean, not the secret itself, so
  # unmark it — otherwise it taints `count` and the `target` output as sensitive.
  create_pull_secret = nonsensitive(var.image_pull_secret_dockerconfigjson != "")
}

resource "kubernetes_namespace" "this" {
  count = var.create_namespace ? 1 : 0
  metadata {
    name   = var.namespace
    labels = local.labels
  }
}

# Optional pull secret for a private registry. When absent, the cluster's node
# credentials (or a public image) are used.
resource "kubernetes_secret" "pull" {
  count = local.create_pull_secret ? 1 : 0
  metadata {
    name      = "${var.name}-pull"
    namespace = local.namespace
    labels    = local.labels
  }
  type = "kubernetes.io/dockerconfigjson"
  data = {
    ".dockerconfigjson" = var.image_pull_secret_dockerconfigjson
  }
}

# --- Run identity. Token automount is OFF: a one-shot agent talks to the git
#     forge with an env token, not the Kubernetes API, so it needs no mounted
#     credential (mirrors the Fargate module, which omits the task app role).
resource "kubernetes_service_account" "this" {
  metadata {
    name      = var.name
    namespace = local.namespace
    labels    = local.labels
  }
  automount_service_account_token = false

  dynamic "image_pull_secret" {
    for_each = local.create_pull_secret ? [1] : []
    content {
      name = kubernetes_secret.pull[0].metadata[0].name
    }
  }
}

# --- Optional, least-privilege RBAC: read-only on the account's own pods/logs
#     in this namespace. Off by default (see the variable's rationale).
resource "kubernetes_role" "this" {
  count = var.grant_namespace_pod_access ? 1 : 0
  metadata {
    name      = var.name
    namespace = local.namespace
    labels    = local.labels
  }
  rule {
    api_groups = [""]
    resources  = ["pods", "pods/log"]
    verbs      = ["get", "list", "watch"]
  }
}

resource "kubernetes_role_binding" "this" {
  count = var.grant_namespace_pod_access ? 1 : 0
  metadata {
    name      = var.name
    namespace = local.namespace
    labels    = local.labels
  }
  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "Role"
    name      = kubernetes_role.this[0].metadata[0].name
  }
  subject {
    kind      = "ServiceAccount"
    name      = kubernetes_service_account.this.metadata[0].name
    namespace = local.namespace
  }
}

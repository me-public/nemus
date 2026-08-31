variable "name" {
  description = "Name for the service account (and RBAC objects, if enabled)."
  type        = string
  default     = "nemus-agent"
}

variable "namespace" {
  description = "Namespace the agent Jobs run in."
  type        = string
  default     = "nemus"
}

variable "create_namespace" {
  description = "Create the namespace. Set false to reuse an existing one."
  type        = bool
  default     = true
}

variable "kube_config_path" {
  description = "Path to the kubeconfig used to provision (and, by default, to run)."
  type        = string
  default     = "~/.kube/config"
}

variable "kube_context" {
  description = "kubeconfig context to target. Empty uses the current-context. Also handed to the runner so kubectl targets the same cluster."
  type        = string
  default     = ""
}

variable "image_pull_secret_dockerconfigjson" {
  description = "A docker `config.json` (dockerconfigjson) for pulling the agent image from a private registry. Empty skips creating a pull secret."
  type        = string
  default     = ""
  sensitive   = true
}

variable "grant_namespace_pod_access" {
  description = "Opt-in: bind a namespace-scoped Role letting the Job's service account read its own pods + logs. Off by default — a one-shot agent authenticates to the git forge with an env token and needs no in-cluster API access."
  type        = bool
  default     = false
}

variable "labels" {
  description = "Extra labels applied to every created object."
  type        = map(string)
  default     = {}
}

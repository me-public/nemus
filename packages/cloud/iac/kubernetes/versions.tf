terraform {
  required_version = ">= 1.6"
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.30"
    }
  }
}

# Talks to whatever cluster your kubeconfig points at. `config_context = ""`
# uses the kubeconfig's current-context; set it to pin a specific cluster.
provider "kubernetes" {
  config_path    = var.kube_config_path
  config_context = var.kube_context != "" ? var.kube_context : null
}

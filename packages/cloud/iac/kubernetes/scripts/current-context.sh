#!/bin/sh
# Resolve the kubeconfig's active context so the emitted TargetDescriptor pins
# the cluster `up()` actually ran against, instead of the ambient
# "current-context" a later run or a `down()` on another machine could silently
# re-point. Consumed by a `data "external"` block: reads the query as JSON on
# stdin ({"kubeconfig":"<path>"}) and MUST print a single JSON object
# ({"context":"..."}) on stdout. Always exits 0 (empty context when kubectl is
# absent or no context is set) so tofu/terraform never fails on it.
set -eu

# Pull the kubeconfig path out of the stdin query. POSIX sh has no JSON parser,
# but the value is a filesystem path whose shape we control, so a targeted
# extraction is safe enough. Resolving from the SAME kubeconfig the provider
# provisions against (var.kube_config_path) is the whole point — otherwise a
# non-default kubeconfig would pin a different cluster's current-context.
query=$(cat 2>/dev/null || true)
kubeconfig=$(printf '%s' "$query" | sed -n 's/.*"kubeconfig"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

# Expand a leading ~ ourselves — kubectl won't, since the path is passed quoted.
case "$kubeconfig" in
  "~") kubeconfig="$HOME" ;;
  "~/"*) kubeconfig="$HOME/${kubeconfig#\~/}" ;;
esac

if [ -n "$kubeconfig" ]; then
  ctx=$(kubectl --kubeconfig="$kubeconfig" config current-context 2>/dev/null || true)
else
  ctx=$(kubectl config current-context 2>/dev/null || true)
fi

# JSON-escape backslash and double-quote (unlikely in a context name, but safe).
esc=$(printf '%s' "$ctx" | sed 's/\\/\\\\/g; s/"/\\"/g')
printf '{"context":"%s"}\n' "$esc"

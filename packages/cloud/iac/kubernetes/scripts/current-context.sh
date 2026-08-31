#!/bin/sh
# Resolve the kubeconfig's active context so the emitted TargetDescriptor pins
# the cluster `up()` actually ran against, instead of the ambient
# "current-context" a later run or a `down()` on another machine could silently
# re-point. Consumed by a `data "external"` block, so it MUST print a single
# JSON object ({"context":"..."}) on stdout. Always exits 0 (empty context when
# kubectl is absent or no context is set) so tofu/terraform never fails on it.
set -eu
ctx=$(kubectl config current-context 2>/dev/null || true)
# JSON-escape backslash and double-quote (unlikely in a context name, but safe).
esc=$(printf '%s' "$ctx" | sed 's/\\/\\\\/g; s/"/\\"/g')
printf '{"context":"%s"}\n' "$esc"

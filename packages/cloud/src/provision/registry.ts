import { Provisioner } from '../runner/types';
import { OpenTofuProvisioner, OpenTofuProvisionerOptions } from './opentofu';

/** A factory that builds a Provisioner from opaque options. */
export type ProvisionerFactory = (opts: Record<string, unknown>) => Provisioner;

const registry = new Map<string, ProvisionerFactory>();

/** Register (or override) a provisioner factory by name. */
export function registerProvisioner(name: string, factory: ProvisionerFactory): void {
  registry.set(name, factory);
}

/** Build a provisioner by name. Throws a helpful error listing what's available. */
export function createProvisioner(name: string, opts: Record<string, unknown> = {}): Provisioner {
  const factory = registry.get(name);
  if (!factory) {
    throw new Error(`unknown provisioner '${name}'. Available: ${provisionerNames().join(', ') || '(none)'}`);
  }
  return factory(opts);
}

/** Names of all registered provisioners. */
export function provisionerNames(): string[] {
  return [...registry.keys()];
}

// Built-in: OpenTofu/Terraform. One provisioner, many modules.
registerProvisioner('opentofu', (o) => new OpenTofuProvisioner(o as unknown as OpenTofuProvisionerOptions));
// `terraform` is the same provisioner with a different bin.
registerProvisioner('terraform', (o) => new OpenTofuProvisioner({ ...(o as object), bin: 'terraform' } as OpenTofuProvisionerOptions));

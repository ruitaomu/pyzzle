/**
 * Feature flags for Pyzzle
 * This configuration controls which features are visible and enabled in the UI
 */

export interface FeatureConfig {
  /** Enable turtle module blocks (turtle.forward, turtle.backward, etc.) */
  enableTurtle: boolean
  /** Enable remote code execution (run button, console, execution controls) */
  enableRemoteExecution: boolean
}

/**
 * Get feature configuration from environment or use defaults
 * Environment variables can override defaults:
 * - VITE_ENABLE_TURTLE=true|false
 * - VITE_ENABLE_REMOTE_EXECUTION=true|false
 */
export function getFeatureConfig(): FeatureConfig {
  return {
    enableTurtle: parseEnvBoolean(import.meta.env.VITE_ENABLE_TURTLE, true),
    enableRemoteExecution: parseEnvBoolean(import.meta.env.VITE_ENABLE_REMOTE_EXECUTION, true),
  }
}

function parseEnvBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue
  return value === 'true' || value === '1' || value === 'yes'
}

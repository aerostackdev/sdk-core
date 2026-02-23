import { safeValidateRegistryConfig } from '@aerostack/core';

/**
 * Aerostack Community Registry tools
 */
export class AerostackCommunity {
    /**
     * Validates a function's aerostack.json configuration.
     * 
     * @example
     * ```typescript
     * const config = await fs.readJson('aerostack.json');
     * const result = sdk.community.validateConfig(config);
     * if (!result.success) {
     *   console.error('Invalid config:', result.error.format());
     * }
     * ```
     */
    validateConfig(config: unknown) {
        return safeValidateRegistryConfig(config);
    }

    /**
     * Checks if a provided object is a valid Aerostack registry configuration version 1.
     */
    isValidConfig(config: unknown): boolean {
        return safeValidateRegistryConfig(config).success;
    }
}

import { describe, it, expect, vi } from 'vitest';

// Mock the core registry module since it requires build artifacts
vi.mock('@aerostack/core/schemas/registry', () => ({
  safeValidateRegistryConfig: (config: unknown) => {
    // Minimal validation: check required fields
    if (!config || typeof config !== 'object') {
      return { success: false, error: new Error('Invalid config') };
    }
    const c = config as any;
    if (!c.name || !c.version || !c.description || !c.type || !c.$schema) {
      return { success: false, error: new Error('Missing required fields') };
    }
    if (c.name.length < 3) {
      return { success: false, error: new Error('Name too short') };
    }
    return { success: true, data: config };
  },
}));

import { AerostackCommunity } from '../community';

describe('AerostackCommunity', () => {
  const community = new AerostackCommunity();

  describe('validateConfig', () => {
    it('should return success for a valid config', () => {
      const result = community.validateConfig({
        $schema: 'https://aerostack.dev/schema/v1',
        name: 'my-function',
        version: '1.0.0',
        description: 'A valid function description',
        type: 'hook',
      });
      expect(result.success).toBe(true);
    });

    it('should return failure for an invalid config (name too short)', () => {
      const result = community.validateConfig({
        $schema: 'https://aerostack.dev/schema/v1',
        name: 'AB',
        version: '1.0.0',
        description: 'desc',
        type: 'hook',
      });
      expect(result.success).toBe(false);
    });

    it('should return failure for empty object', () => {
      const result = community.validateConfig({});
      expect(result.success).toBe(false);
    });

    it('should return failure for null', () => {
      const result = community.validateConfig(null);
      expect(result.success).toBe(false);
    });

    it('should return failure for undefined', () => {
      const result = community.validateConfig(undefined);
      expect(result.success).toBe(false);
    });

    it('should return failure for a string', () => {
      const result = community.validateConfig('not an object');
      expect(result.success).toBe(false);
    });

    it('should return failure for missing required fields', () => {
      const result = community.validateConfig({
        name: 'my-function',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('isValidConfig', () => {
    it('should return true for a valid config', () => {
      expect(community.isValidConfig({
        $schema: 'https://aerostack.dev/schema/v1',
        name: 'my-function',
        version: '1.0.0',
        description: 'A valid function description',
        type: 'hook',
      })).toBe(true);
    });

    it('should return false for an invalid config', () => {
      expect(community.isValidConfig({})).toBe(false);
    });

    it('should return false for null', () => {
      expect(community.isValidConfig(null)).toBe(false);
    });

    it('should return a boolean', () => {
      const result = community.isValidConfig({});
      expect(typeof result).toBe('boolean');
    });
  });
});

import { describe, it, expect } from 'vitest';
import { DEFAULT_API_URL } from '../config';

describe('DEFAULT_API_URL', () => {
  it('should be the Aerostack API v1 URL', () => {
    expect(DEFAULT_API_URL).toBe('https://api.aerostack.dev/v1');
  });

  it('should be a string', () => {
    expect(typeof DEFAULT_API_URL).toBe('string');
  });

  it('should start with https', () => {
    expect(DEFAULT_API_URL.startsWith('https://')).toBe(true);
  });

  it('should end with /v1', () => {
    expect(DEFAULT_API_URL.endsWith('/v1')).toBe(true);
  });
});

import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  setupFiles: ['<rootDir>/src/__tests__/setup.ts'],
  testMatch: ['**/*.spec.ts', '**/*.test.ts'],
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/server.ts'],
};

export default config;

const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const customJestConfig = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/**/*.spec.ts'],
  moduleNameMapper: { '^@hl/shared$': '<rootDir>/../../packages/shared/src/index.ts' },
};

module.exports = createJestConfig(customJestConfig);

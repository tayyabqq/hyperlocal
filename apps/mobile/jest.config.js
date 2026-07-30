module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  moduleNameMapper: { '^@hl/shared$': '<rootDir>/../../packages/shared/src/index.ts' },
};

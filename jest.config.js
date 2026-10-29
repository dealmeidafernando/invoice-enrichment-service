/** @type {import('jest').Config} */
const base = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  moduleFileExtensions: ['ts', 'js', 'json'],
  setupFiles: ['reflect-metadata'],
};

module.exports = {
  // Integration tests share one database and truncate tables between them: run serially.
  maxWorkers: 1,
  projects: [
    {
      ...base,
      displayName: 'unit',
      testMatch: ['<rootDir>/test/unit/**/*.spec.ts'],
    },
    {
      // Real PostgreSQL (DATABASE_URL_TEST): transactions, UNIQUE and SKIP LOCKED cannot be mocked.
      ...base,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/integration/**/*.spec.ts'],
      globalSetup: '<rootDir>/test/support/global-setup.ts',
    },
  ],
};

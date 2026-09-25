/** Integration / e2e tests: run against the chamber_test database (reset + seeded in globalSetup). */
module.exports = {
  rootDir: '..',
  testRegex: 'test/.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testEnvironment: 'node',
  globalSetup: '<rootDir>/test/global-setup.ts',
  globalTeardown: '<rootDir>/test/global-teardown.ts',
  setupFiles: ['<rootDir>/test/load-env.ts'],
  testTimeout: 30000,
};

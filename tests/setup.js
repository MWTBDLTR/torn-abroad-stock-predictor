/* eslint-env jest, node */

// Import jest and test lifecycle functions from @jest/globals
import { jest } from '@jest/globals';

// Create mock objects
const browser = {
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
    },
  },
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn()
    }
  },
};

const fetch = jest.fn();

const mockDB = {
  transaction: jest.fn().mockReturnValue({
    objectStore: jest.fn().mockReturnValue({
      put: jest.fn().mockResolvedValue(undefined),
      add: jest.fn().mockResolvedValue(undefined)
    }),
    done: Promise.resolve()
  })
};

// Assign to globalThis
globalThis.browser = browser;
globalThis.fetch = fetch;
globalThis.mockDB = mockDB;

// Console error/warning suppression for cleaner test output
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

// Suppress console.error and console.warn during tests
console.error = jest.fn();
console.warn = jest.fn();

// Restore console after tests
afterAll(() => {
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
});

// Export mocked objects for test files
export { browser, fetch, mockDB }; 
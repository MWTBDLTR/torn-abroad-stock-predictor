// Mock browser API
global.browser = {
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
    },
  },
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn(),
    },
  },
};

// Mock IndexedDB
const indexedDB = {
  open: jest.fn(),
  deleteDatabase: jest.fn(),
};

global.indexedDB = indexedDB;

// Mock window.fetch
global.fetch = jest.fn();

// Clear all mocks between tests
beforeEach(() => {
  jest.clearAllMocks();
});

// Console error/warning suppression for cleaner test output
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

beforeAll(() => {
  console.error = (...args) => {
    if (typeof args[0] === 'string' && args[0].includes('test was not wrapped in act')) {
      return;
    }
    originalConsoleError.call(console, ...args);
  };
  
  console.warn = (...args) => {
    if (typeof args[0] === 'string' && args[0].includes('async operation')) {
      return;
    }
    originalConsoleWarn.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
}); 
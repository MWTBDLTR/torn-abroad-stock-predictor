/* eslint-env jest, node */

// Import jest from @jest/globals
import { jest } from '@jest/globals';

// Mock cache for market prices
let marketPriceCache = new Map();
let itemTypeCache = new Map();

// Mock rate limiter
const rateLimiter = {
  lastCall: 0,
  minDelay: 0, // No delay in tests
  yataLastCall: 0,
  yataMinDelay: 0, // No delay in tests
  async waitForNextCall() {
    return Promise.resolve();
  }
};

// Mock IndexedDB
const mockIndexedDB = {
  open: jest.fn().mockReturnValue({
    onupgradeneeded: null,
    onsuccess: null,
    onerror: null,
    result: {
      createObjectStore: jest.fn(),
      transaction: jest.fn().mockReturnValue({
        objectStore: jest.fn().mockReturnValue({
          put: jest.fn().mockImplementation(() => ({
            onsuccess: null,
            onerror: null
          })),
          add: jest.fn().mockImplementation(() => ({
            onsuccess: null,
            onerror: null
          })),
          get: jest.fn().mockImplementation(() => ({
            onsuccess: null,
            onerror: null,
            result: null
          })),
          index: jest.fn().mockReturnValue({
            getAll: jest.fn().mockImplementation(() => ({
              onsuccess: null,
              onerror: null,
              result: []
            }))
          })
        }),
        done: Promise.resolve()
      })
    }
  })
};

// Create mock objects
const browser = {
  storage: {
    local: {
      get: jest.fn().mockImplementation(async (keys) => {
        try {
          if (Array.isArray(keys)) {
            const result = {};
            if (keys.includes('apiKey')) {
              result.apiKey = 'test-api-key';
            }
            if (keys.includes('itemTypeCache')) {
              result.itemTypeCache = Object.fromEntries(itemTypeCache);
            }
            if (keys.includes('marketPriceCache')) {
              result.marketPriceCache = Object.fromEntries(marketPriceCache);
            }
            return result;
          }
          return {};
        } catch (error) {
          console.error('Error in browser.storage.local.get mock:', error);
          return {};
        }
      }),
      set: jest.fn().mockImplementation(async (data) => {
        try {
          if (data.itemTypeCache) {
            itemTypeCache = new Map(Object.entries(data.itemTypeCache));
          }
          if (data.marketPriceCache) {
            marketPriceCache = new Map(Object.entries(data.marketPriceCache));
          }
          return Promise.resolve();
        } catch (error) {
          console.error('Error in browser.storage.local.set mock:', error);
          return Promise.reject(error);
        }
      }),
    },
  },
  runtime: {
    sendMessage: jest.fn().mockImplementation(() => Promise.resolve()),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    }
  },
};

const fetch = jest.fn();

const mockDB = {
  transaction: jest.fn().mockImplementation(() => ({
    objectStore: jest.fn().mockReturnValue({
      put: jest.fn().mockImplementation(() => Promise.resolve()),
      add: jest.fn().mockImplementation(() => Promise.resolve()),
      get: jest.fn().mockImplementation(() => Promise.resolve(null))
    }),
    done: Promise.resolve()
  }))
};

// Mock setTimeout to execute immediately
jest.useFakeTimers();
jest.spyOn(global, 'setTimeout').mockImplementation((fn, delay) => {
  fn();
  return {
    unref: () => {},
    ref: () => {},
    [Symbol.toPrimitive]: () => 1
  };
});

// Clear all mocks and caches
const clearMocks = () => {
  jest.clearAllMocks();
  marketPriceCache.clear();
  itemTypeCache.clear();
  
  // Reset IndexedDB mock implementations
  mockIndexedDB.open.mockClear();
  
  // Reset browser storage mock implementations
  browser.storage.local.get.mockImplementation(async (keys) => {
    try {
      if (Array.isArray(keys)) {
        const result = {};
        if (keys.includes('apiKey')) {
          result.apiKey = 'test-api-key';
        }
        if (keys.includes('itemTypeCache')) {
          result.itemTypeCache = Object.fromEntries(itemTypeCache);
        }
        if (keys.includes('marketPriceCache')) {
          result.marketPriceCache = Object.fromEntries(marketPriceCache);
        }
        return result;
      }
      return {};
    } catch (error) {
      console.error('Error in browser.storage.local.get mock:', error);
      return {};
    }
  });

  // Reset fetch mock
  fetch.mockReset();
  
  // Reset runtime message handlers
  browser.runtime.sendMessage.mockClear();
  browser.runtime.onMessage.addListener.mockClear();
  browser.runtime.onMessage.removeListener.mockClear();
};

// Assign to globalThis
globalThis.browser = browser;
globalThis.fetch = fetch;
globalThis.mockDB = mockDB;
globalThis.indexedDB = mockIndexedDB;

// Console error/warning suppression for cleaner test output
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

// Suppress console.error and console.warn during tests
console.error = jest.fn();
console.warn = jest.fn();

// Clean up before each test
beforeEach(() => {
  clearMocks();
  jest.resetModules();
});

// Clean up after all tests
afterAll(() => {
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
  jest.useRealTimers();
});

// Export mocked objects and utilities for test files
export { 
  browser, 
  fetch, 
  mockDB, 
  clearMocks, 
  rateLimiter,
  marketPriceCache,
  itemTypeCache
}; 
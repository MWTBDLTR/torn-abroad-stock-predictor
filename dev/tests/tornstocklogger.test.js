/* eslint-env jest, node */

// Mock the module-level variables first
jest.mock('../src/background/torn-stock-predictor.js', () => {
  const actual = jest.requireActual('../src/background/torn-stock-predictor.js');
  return {
    ...actual,
    apiKey: 'test-api-key',
    marketPriceCache: new Map(),
    itemTypeCache: new Map(),
    rateLimiter: {
      lastCall: 0,
      minDelay: 0,
      yataLastCall: 0,
      yataMinDelay: 0,
      async waitForNextCall() {
        return Promise.resolve();
      }
    }
  };
});

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  calculateProfitPerMinute,
  fetchAndLogStock,
  fetchMarketPriceForItem,
  saveStockSnapshot
} from '../src/background/torn-stock-predictor.js';

// Import test setup mocks
import { browser, fetch, mockDB, clearMocks, marketPriceCache, itemTypeCache } from './setup.js';

describe('TornStockLogger', () => {
  beforeEach(() => {
    clearMocks();
    jest.resetModules();
  });

  afterEach(async () => {
    // Wait for any pending promises to resolve
    await Promise.resolve();
  });

  describe('calculateProfitPerMinute', () => {
    it('should calculate profit per minute correctly', () => {
      const cost = 1000;
      const market = 2000;
      const flightTime = 30;
      const expected = 16.67;
      
      expect(calculateProfitPerMinute(cost, market, flightTime)).toBeCloseTo(expected, 2);
    });

    it('should return 0 when flight time is 0', () => {
      expect(calculateProfitPerMinute(1000, 2000, 0)).toBe(0);
    });

    it('should handle invalid inputs', () => {
      expect(calculateProfitPerMinute(null, undefined, 'invalid')).toBe(0);
      expect(calculateProfitPerMinute('1000', '2000', '30')).toBeCloseTo(16.67, 2);
    });
  });

  describe('API Integration', () => {
    it('should handle YATA API response correctly', async () => {
      const mockYataResponse = {
        timestamp: Date.now() / 1000,
        stocks: {
          mex: {
            update: Date.now() / 1000,
            stocks: [
              { id: 1, name: 'Plushie', quantity: 100, cost: 500 }
            ]
          }
        }
      };

      fetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockYataResponse),
        })
      );

      await fetchAndLogStock();

      expect(browser.storage.local.set).toHaveBeenCalled();
      const setCall = browser.storage.local.set.mock.calls[0][0];
      expect(setCall).toHaveProperty('stockData');
      expect(setCall.stockData).toHaveProperty('mex');
    });

    it('should handle Torn API response correctly', async () => {
      const mockTornResponse = {
        itemmarket: {
          item: {
            type: 'Plushie',
            average_price: 1000
          },
          listings: [
            { price: 950 },
            { price: 1000 },
            { price: 1050 }
          ]
        }
      };

      fetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTornResponse),
        })
      );

      const result = await fetchMarketPriceForItem(1);

      expect(result).toEqual({
        price: 1000,
        type: 'Plushie',
        timestamp: expect.any(Number)
      });
    });

    it('should cache market prices', async () => {
      const mockResponse = {
        itemmarket: {
          item: { type: 'Plushie', average_price: 1000 },
          listings: [{ price: 1000 }]
        }
      };

      fetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        })
      );

      // First call should fetch
      const result1 = await fetchMarketPriceForItem(1);
      
      // Verify the cache was updated
      expect(marketPriceCache.size).toBe(1);
      expect(marketPriceCache.has('1')).toBe(true);
      
      // Second call should use cache
      const result2 = await fetchMarketPriceForItem(1);

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result1).toEqual(result2);
    });

    it('should handle cache expiration', async () => {
      const mockResponse = {
        itemmarket: {
          item: { type: 'Plushie', average_price: 1000 },
          listings: [{ price: 1000 }]
        }
      };

      // Set up an expired cache entry
      const expiredTimestamp = Date.now() - (30 * 60 * 1000); // 30 minutes ago
      marketPriceCache.set('1', {
        price: 900,
        type: 'Plushie',
        timestamp: expiredTimestamp
      });

      fetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        })
      );

      const result = await fetchMarketPriceForItem(1);

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.price).toBe(1000);
      expect(result.timestamp).toBeGreaterThan(expiredTimestamp);
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors gracefully', async () => {
      fetch.mockImplementationOnce(() =>
        Promise.reject(new Error('Network error'))
      );

      const result = await fetchMarketPriceForItem(1);
      
      expect(result).toEqual({
        price: 0,
        type: null,
        timestamp: expect.any(Number)
      });
    });

    it('should handle invalid data gracefully', async () => {
      fetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        })
      );

      const result = await fetchMarketPriceForItem(1);
      
      expect(result).toEqual({
        price: 0,
        type: null,
        timestamp: expect.any(Number)
      });
    });

    it('should handle YATA API rate limits', async () => {
      const rateLimitResponse = {
        error: {
          code: 3,
          error: 'Rate limit exceeded'
        }
      };

      fetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          status: 429,
          json: () => Promise.resolve(rateLimitResponse),
        })
      );

      await expect(fetchAndLogStock()).resolves.not.toThrow();
      expect(browser.storage.local.set).not.toHaveBeenCalled();
    });

    it('should handle browser storage errors', async () => {
      const mockYataResponse = {
        timestamp: Date.now() / 1000,
        stocks: {
          mex: {
            update: Date.now() / 1000,
            stocks: [
              { id: 1, name: 'Plushie', quantity: 100, cost: 500 }
            ]
          }
        }
      };

      fetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockYataResponse),
        })
      );

      browser.storage.local.set.mockImplementationOnce(() =>
        Promise.reject(new Error('Storage error'))
      );

      await expect(fetchAndLogStock()).resolves.not.toThrow();
    });
  });

  describe('Database Operations', () => {
    it('should save stock snapshot correctly', async () => {
      const snapshot = {
        timestamp: Date.now(),
        stocks: {
          mex: {
            items: [
              { id: 1, name: 'Plushie', quantity: 100, cost: 500 }
            ]
          }
        }
      };

      await saveStockSnapshot(snapshot);

      expect(mockDB.transaction).toHaveBeenCalled();
      const objectStore = mockDB.transaction().objectStore();
      expect(objectStore.put).toHaveBeenCalledWith(snapshot);
    });

    it('should handle database errors gracefully', async () => {
      const snapshot = {
        timestamp: Date.now(),
        stocks: {}
      };

      mockDB.transaction.mockImplementationOnce(() => {
        throw new Error('Database error');
      });

      await expect(saveStockSnapshot(snapshot)).resolves.not.toThrow();
    });
  });
}); 
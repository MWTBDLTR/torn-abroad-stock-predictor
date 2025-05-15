describe('TornStockLogger', () => {
  beforeEach(() => {
    // Mock browser.storage.local
    global.browser = {
      storage: {
        local: {
          get: jest.fn(),
          set: jest.fn(),
        },
      },
      runtime: {
        sendMessage: jest.fn(),
      },
    };

    // Mock fetch
    global.fetch = jest.fn();

    // Mock IndexedDB
    const mockIndexedDB = {
      transaction: jest.fn().mockReturnValue({
        objectStore: jest.fn().mockReturnValue({
          put: jest.fn().mockResolvedValue(undefined),
          add: jest.fn().mockResolvedValue(undefined)
        }),
        done: Promise.resolve()
      })
    };
    global.mockDB = mockIndexedDB;
  });

  describe('calculateProfitPerMinute', () => {
    it('should calculate profit per minute correctly', () => {
      const cost = 1000;
      const market = 2000;
      const flightTime = 30;
      const expected = (market - cost) / (flightTime * 2);
      
      expect(calculateProfitPerMinute(cost, market, flightTime)).toBe(expected);
    });

    it('should return 0 when flight time is 0', () => {
      expect(calculateProfitPerMinute(1000, 2000, 0)).toBe(0);
    });

    it('should handle invalid inputs', () => {
      expect(calculateProfitPerMinute(null, undefined, 'invalid')).toBe(0);
      expect(calculateProfitPerMinute('1000', '2000', '30')).toBe(16.67); // Should convert strings to numbers
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
              { id: 1, name: "Plushie", quantity: 100, cost: 500 }
            ]
          }
        }
      };

      global.fetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockYataResponse),
        })
      );

      await fetchAndLogStock();

      // Verify data was processed and stored
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

      global.fetch.mockImplementationOnce(() =>
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

      global.fetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        })
      );

      // First call should fetch
      await fetchMarketPriceForItem(1);
      // Second call should use cache
      await fetchMarketPriceForItem(1);

      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors gracefully', async () => {
      global.fetch.mockImplementationOnce(() =>
        Promise.reject(new Error('Network error'))
      );

      const result = await fetchMarketPriceForItem(1);
      
      expect(result).toEqual({
        price: 0,
        type: null
      });
    });

    it('should handle invalid data gracefully', async () => {
      global.fetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        })
      );

      const result = await fetchMarketPriceForItem(1);
      
      expect(result).toEqual({
        price: 0,
        type: null
      });
    });

    it('should handle YATA API rate limits', async () => {
      const rateLimitResponse = {
        error: {
          code: 3,
          error: 'Rate limit exceeded'
        }
      };

      global.fetch
        .mockImplementationOnce(() =>
          Promise.resolve({
            ok: false,
            status: 429,
            json: () => Promise.resolve(rateLimitResponse),
          })
        )
        .mockImplementationOnce(() =>
          Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ stocks: {}, timestamp: Date.now() / 1000 }),
          })
        );

      await fetchAndLogStock();
      
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Database Operations', () => {
    it('should save stock snapshots correctly', async () => {
      const db = global.mockDB;
      const data = {
        country: 'mex',
        item_id: 1,
        quantity: 100,
        timestamp: Math.floor(Date.now() / 1000)
      };

      await saveStockSnapshot(db, data.country, data.item_id, data.quantity, data.timestamp);

      expect(db.transaction).toHaveBeenCalledWith('stock_history', 'readwrite');
    });
  });
}); 
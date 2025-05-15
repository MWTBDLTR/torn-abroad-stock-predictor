/* eslint-env jest, node */

import { jest, describe, it, expect } from '@jest/globals';
import { calculateProfitPerMinute } from '../src/background/index.js';

describe('TornStockLogger Utils', () => {
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
}); 
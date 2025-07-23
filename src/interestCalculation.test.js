/**
 * Interest Calculation Tests
 * 
 * These tests are designed to validate the interest calculation logic
 * in your AppLayout.tsx component. Run these tests to ensure your
 * leap year handling and edge cases work correctly.
 * 
 * To run: npm test or vitest run src/interestCalculation.test.js
 */

import { describe, test, expect } from 'vitest';
import dayjs from 'dayjs';
import dayOfYear from 'dayjs/plugin/dayOfYear';
import isLeapYear from 'dayjs/plugin/isLeapYear';

// Import the actual calculateInterest function from your utility file
import { calculateInterest } from './utils/interestCalculation';

dayjs.extend(dayOfYear);
dayjs.extend(isLeapYear);

describe('Interest Calculation Tests', () => {
  
  // Helper function to create test entries
  const createEntry = (nominal, zinssatz) => ({ nominal, zinssatz });

  describe('1. Basic Functionality Tests', () => {
    
    test('should calculate simple interest for full non-leap year', () => {
      const entry = createEntry(1000, 5);
      const startDate = dayjs('2023-01-01');
      const endDate = dayjs('2023-12-31'); // 365 days (inclusive counting)
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Expected: 1000 * 0.05 * (365/365) = 50.00
      expect(result).toBeCloseTo(50.00, 2);
    });

    test('should calculate simple interest for full leap year', () => {
      const entry = createEntry(1000, 5);
      const startDate = dayjs('2024-01-01');
      const endDate = dayjs('2024-12-31'); // 366 days in leap year (inclusive counting)
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Expected: 1000 * 0.05 * (366/366) = 50.00
      expect(result).toBeCloseTo(50.00, 2);
    });

    test('should calculate interest for half year period', () => {
      const entry = createEntry(1000, 5);
      const startDate = dayjs('2023-01-01');
      const endDate = dayjs('2023-07-01'); // 182 days (inclusive counting)
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Expected: 1000 * 0.05 * (182/365) = 24.93
      expect(result).toBeCloseTo(24.93, 2);
    });
  });

  describe('2. Leap Year Edge Cases', () => {
    
    test('should handle February 29th in leap year', () => {
      const entry = createEntry(1000, 5);
      const startDate = dayjs('2024-02-01');
      const endDate = dayjs('2024-03-01'); // 29 days (includes Feb 29)
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Expected: 1000 * 0.05 * (30/366) = 4.10 (inclusive counting)
      expect(result).toBeCloseTo(4.10, 2);
    });

    test('should handle February in non-leap year', () => {
      const entry = createEntry(1000, 5);
      const startDate = dayjs('2023-02-01');
      const endDate = dayjs('2023-03-01'); // 28 days
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Expected: 1000 * 0.05 * (29/365) = 3.97 (inclusive counting)
      expect(result).toBeCloseTo(3.97, 2);
    });

    test('should handle period starting on leap day', () => {
      const entry = createEntry(1000, 5);
      const startDate = dayjs('2024-02-29');
      const endDate = dayjs('2024-03-01'); // 2 days (inclusive counting)
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Expected: 1000 * 0.05 * (2/366) = 0.27
      expect(result).toBeCloseTo(0.27, 2);
    });

    test('should handle period ending on leap day', () => {
      const entry = createEntry(1000, 5);
      const startDate = dayjs('2024-02-28');
      const endDate = dayjs('2024-02-29'); // 2 days (inclusive counting)
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Expected: 1000 * 0.05 * (2/366) = 0.27
      expect(result).toBeCloseTo(0.27, 2);
    });

    test('should handle spanning leap day (Jan 15 - Mar 15, 2024)', () => {
      const entry = createEntry(1000, 5);
      const startDate = dayjs('2024-01-15');
      const endDate = dayjs('2024-03-15'); // 60 days
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Expected: 1000 * 0.05 * (61/366) = 8.33 (inclusive counting)
      expect(result).toBeCloseTo(8.33, 2);
    });
  });

  describe('3. Cross-Year Period Tests', () => {
    
    test('should handle period from leap year to non-leap year', () => {
      const entry = createEntry(1000, 5);
      const startDate = dayjs('2024-12-01');
      const endDate = dayjs('2025-01-31'); // 61 days total
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // This should use weighted average calculation
      // 32 days in 2024 (366-day year) + 31 days in 2025 (365-day year) - inclusive counting
      // Weighted average: (32*366 + 31*365) / 62 = 365.51
      // Expected: 1000 * 0.05 * (62/365.51) = 8.48
      expect(result).toBeCloseTo(8.48, 1); // Allow 0.1 tolerance for weighted calculation
    });

    test('should handle period from non-leap year to leap year', () => {
      const entry = createEntry(1000, 5);
      const startDate = dayjs('2023-12-01');
      const endDate = dayjs('2024-01-31'); // 61 days total
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // 32 days in 2023 (365-day year) + 31 days in 2024 (366-day year) - inclusive counting
      // Weighted average: (32*365 + 31*366) / 62 = 365.49
      // Expected: 1000 * 0.05 * (62/365.49) = 8.48
      expect(result).toBeCloseTo(8.48, 1);
    });

    test('should handle New Year boundary (Dec 31 - Jan 1)', () => {
      const entry = createEntry(1000, 5);
      const startDate = dayjs('2023-12-31');
      const endDate = dayjs('2024-01-01'); // 1 day
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // This tests which year basis is used for cross-year single day
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(1);
    });
  });

  describe('4. Edge Cases - Date Boundaries', () => {
    
    test('should calculate interest for same day period', () => {
      const entry = createEntry(1000, 5);
      const startDate = dayjs('2024-01-01');
      const endDate = dayjs('2024-01-01'); // 1 day (inclusive counting)
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Expected: 1000 * 0.05 * (1/366) = 0.14
      expect(result).toBeCloseTo(0.14, 2);
    });

    test('should calculate interest for one day period', () => {
      const entry = createEntry(1000, 5);
      const startDate = dayjs('2024-01-01');
      const endDate = dayjs('2024-01-02'); // 2 days (inclusive counting)
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Expected: 1000 * 0.05 * (2/366) = 0.27
      expect(result).toBeCloseTo(0.27, 2);
    });

    test('should handle end of month boundaries', () => {
      const entry = createEntry(1000, 5);
      const startDate = dayjs('2024-01-31');
      const endDate = dayjs('2024-02-01'); // 2 days (inclusive counting)
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Expected: 1000 * 0.05 * (2/366) = 0.27
      expect(result).toBeCloseTo(0.27, 2);
    });
  });

  describe('5. Century Leap Year Tests', () => {
    
    test('should handle century year that is NOT a leap year (1900)', () => {
      const entry = createEntry(1000, 5);
      const startDate = dayjs('1900-01-01');
      const endDate = dayjs('1900-12-31'); // 364 days (1900 is not a leap year)
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Expected: 1000 * 0.05 * (365/365) = 50.00 (inclusive counting)
      expect(result).toBeCloseTo(50.00, 2);
    });

    test('should handle century year that IS a leap year (2000)', () => {
      const entry = createEntry(1000, 5);
      const startDate = dayjs('2000-01-01');
      const endDate = dayjs('2000-12-31'); // 365 days (2000 is a leap year)
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Expected: 1000 * 0.05 * (366/366) = 50.00 (inclusive counting)
      expect(result).toBeCloseTo(50.00, 2);
    });
  });

  describe('6. Rounding and Precision Tests', () => {
    
    test('should round to 2 decimal places correctly', () => {
      const entry = createEntry(1000, 3.333);
      const startDate = dayjs('2023-01-01');
      const endDate = dayjs('2023-04-11'); // 100 days
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Expected: 1000 * 0.03333 * (101/365) = 9.22 (inclusive counting)
      expect(result).toBe(9.22);
    });

    test('should handle very small amounts', () => {
      const entry = createEntry(0.01, 1);
      const startDate = dayjs('2023-01-01');
      const endDate = dayjs('2023-01-02'); // 1 day
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Should round to 0.00
      expect(result).toBe(0.00);
    });

    test('should handle large amounts', () => {
      const entry = createEntry(1000000, 5);
      const startDate = dayjs('2023-01-01');
      const endDate = dayjs('2023-12-31'); // 364 days
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Expected: 1000000 * 0.05 * (365/365) = 50000.00 (inclusive counting)
      expect(result).toBeCloseTo(50000.00, 2);
    });

    test('should handle rounding edge cases', () => {
      // Test case that results in exactly .125 (banker's rounding test)
      const entry = createEntry(1000, 4.5625);
      const startDate = dayjs('2023-01-01');
      const endDate = dayjs('2023-01-02'); // 2 days (inclusive counting)
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // 1000 * 0.045625 * (2/365) = 0.25 → should round to 0.25
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThanOrEqual(0.24);
      expect(result).toBeLessThanOrEqual(0.26);
    });
  });

  describe('7. Rate Edge Cases', () => {
    
    test('should handle zero interest rate', () => {
      const entry = createEntry(1000, 0);
      const startDate = dayjs('2024-01-01');
      const endDate = dayjs('2024-12-31');
      
      const result = calculateInterest(entry, startDate, endDate);
      
      expect(result).toBe(0.00);
    });

    test('should handle very high interest rate', () => {
      const entry = createEntry(1000, 100);
      const startDate = dayjs('2024-01-01');
      const endDate = dayjs('2024-12-31'); // 365 days
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Expected: 1000 * 1.00 * (366/366) = 1000.00 (inclusive counting)
      expect(result).toBeCloseTo(1000.00, 2);
    });

    test('should handle fractional interest rates', () => {
      const entry = createEntry(1000, 2.5);
      const startDate = dayjs('2023-01-01');
      const endDate = dayjs('2023-12-31'); // 364 days
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Expected: 1000 * 0.025 * (365/365) = 25.00 (inclusive counting)
      expect(result).toBeCloseTo(25.00, 2);
    });
  });

  describe('8. Quarterly Calculation Tests', () => {
    
    test('should calculate Q1 interest in leap year (includes Feb 29)', () => {
      const entry = createEntry(1000, 5);
      const startDate = dayjs('2024-01-01');
      const endDate = dayjs('2024-03-31'); // 90 days in Q1 2024
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Expected: 1000 * 0.05 * (91/366) = 12.43 (inclusive counting)
      expect(result).toBeCloseTo(12.43, 2);
    });

    test('should calculate Q1 interest in non-leap year', () => {
      const entry = createEntry(1000, 5);
      const startDate = dayjs('2023-01-01');
      const endDate = dayjs('2023-03-31'); // 89 days in Q1 2023
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Expected: 1000 * 0.05 * (90/365) = 12.33 (inclusive counting)
      expect(result).toBeCloseTo(12.33, 2);
    });

    test('should calculate Q4 spanning year end', () => {
      const entry = createEntry(1000, 5);
      const startDate = dayjs('2024-10-01');
      const endDate = dayjs('2024-12-31'); // 91 days
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Expected: 1000 * 0.05 * (92/366) = 12.57 (inclusive counting)
      expect(result).toBeCloseTo(12.57, 2);
    });
  });

  describe('9. Multi-Year Period Tests', () => {
    
    test('should handle two full years (both non-leap)', () => {
      const entry = createEntry(1000, 5);
      const startDate = dayjs('2021-01-01');
      const endDate = dayjs('2022-12-31'); // 729 days (364 + 365)
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Should be close to 100.00 for 2 years (inclusive counting)
      expect(result).toBeCloseTo(100.00, 1);
    });

    test('should handle period including one leap year', () => {
      const entry = createEntry(1000, 5);
      const startDate = dayjs('2023-01-01');
      const endDate = dayjs('2024-12-31'); // 730 days (364 + 366)
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Should use weighted average calculation (inclusive counting)
      expect(result).toBeCloseTo(100.00, 1);
    });

    test('should handle very long period (5 years)', () => {
      const entry = createEntry(1000, 5);
      const startDate = dayjs('2020-01-01');
      const endDate = dayjs('2024-12-31'); // ~5 years
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Should be approximately 250.00 for 5 years (inclusive counting)
      expect(result).toBeCloseTo(250.00, 1);
    });
  });

  describe('10. Real-World Scenarios', () => {
    
    test('should handle typical 3-month deposit', () => {
      const entry = createEntry(5000, 3.5);
      const startDate = dayjs('2024-01-01');
      const endDate = dayjs('2024-04-01'); // 92 days (inclusive counting)
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Expected: 5000 * 0.035 * (92/366) = 43.99
      expect(result).toBeCloseTo(43.99, 2);
    });

    test('should handle 6-month deposit spanning leap day', () => {
      const entry = createEntry(10000, 4.0);
      const startDate = dayjs('2024-01-01');
      const endDate = dayjs('2024-07-01'); // 183 days (inclusive counting)
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Expected: 10000 * 0.04 * (183/366) = 200.00
      expect(result).toBeCloseTo(200.00, 2);
    });

    test('should handle account opening mid-year', () => {
      const entry = createEntry(25000, 2.75);
      const startDate = dayjs('2024-07-15');
      const endDate = dayjs('2024-12-31'); // 170 days (inclusive counting)
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Expected: 25000 * 0.0275 * (170/366) = 319.33
      expect(result).toBeCloseTo(319.33, 2);
    });

    test('should handle early account closure', () => {
      const entry = createEntry(15000, 3.25);
      const startDate = dayjs('2024-01-01');
      const endDate = dayjs('2024-06-15'); // 167 days (inclusive counting)
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Expected: 15000 * 0.0325 * (167/366) = 222.44
      expect(result).toBeCloseTo(222.44, 2);
    });
  });

  describe('11. Interest Calculation Consistency', () => {
    
    test('should produce consistent results for equivalent periods', () => {
      const entry = createEntry(1000, 5);
      
      // Two equivalent 30-day periods in same year should give same result
      const jan = calculateInterest(entry, dayjs('2024-01-01'), dayjs('2024-01-31'));
      const feb = calculateInterest(entry, dayjs('2024-02-01'), dayjs('2024-03-02')); // 30 days
      
      // Results should be very close (allowing for small differences due to month lengths)
      expect(Math.abs(jan - feb)).toBeLessThan(0.5);
    });

    test('should handle leap year vs non-leap year consistently', () => {
      const entry = createEntry(1000, 5);
      
      // Same period in leap vs non-leap year
      const leap = calculateInterest(entry, dayjs('2024-01-01'), dayjs('2024-01-31')); // 30 days in leap year
      const nonLeap = calculateInterest(entry, dayjs('2023-01-01'), dayjs('2023-01-31')); // 30 days in non-leap year
      
      // Leap year should give slightly lower interest (same days, higher year basis)
      expect(leap).toBeLessThan(nonLeap);
    });

    test('should scale proportionally with principal amount', () => {
      const small = createEntry(1000, 5);
      const large = createEntry(10000, 5);
      const startDate = dayjs('2024-01-01');
      const endDate = dayjs('2024-06-01');
      
      const smallResult = calculateInterest(small, startDate, endDate);
      const largeResult = calculateInterest(large, startDate, endDate);
      
      // Large amount should be approximately 10x the small amount (allowing for rounding differences)
      expect(largeResult).toBeCloseTo(smallResult * 10, 1);
    });
  });

  describe('12. Day Calculation Verification', () => {
    test('should calculate correct days for 19.04.2023 to 22.04.2025 period', () => {
      const entry = createEntry(1000000, 3.6);
      const startDate = dayjs('2023-04-19');
      const endDate = dayjs('2025-04-22');
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Manual verification: 19.04.2023 to 22.04.2025 should be 735 days (inclusive counting)
      // Expected: 1000000 * 0.036 * (735 / weighted_year_basis) = 72394.38
      expect(result).toBeCloseTo(72394.38, 2);
    });
  });

  describe('13. Performance and Edge Cases', () => {
    
    test('should handle very short periods efficiently', () => {
      const entry = createEntry(1000, 5);
      const startDate = dayjs('2024-01-01');
      const endDate = dayjs('2024-01-01').add(1, 'hour'); // Same day
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // With inclusive counting, same day should return 1 day of interest
      // Expected: 1000 * 0.05 * (1/366) = 0.14
      expect(result).toBeCloseTo(0.14, 2);
    });

    test('should handle future dates gracefully', () => {
      const entry = createEntry(1000, 5);
      const startDate = dayjs('2030-01-01');
      const endDate = dayjs('2030-12-31');
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Should calculate normally for future dates
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
    });

    test('should handle historical dates', () => {
      const entry = createEntry(1000, 5);
      const startDate = dayjs('1990-01-01');
      const endDate = dayjs('1990-12-31');
      
      const result = calculateInterest(entry, startDate, endDate);
      
      // Should calculate normally for historical dates
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
    });
  });
});

describe('13. User Reported Issue', () => {
  test('should calculate correct days for 19.04.2023 to 22.04.2025 period', () => {
    const entry = {
      bankName: 'Test Bank',
      kontoNumber: '12345',
      startDatum: dayjs('2023-04-19'),
      endDatum: dayjs('2025-04-22'),
      nominal: 1000000,
      zinssatz: 3.6
    };
    const startDate = dayjs('2023-04-19');
    const endDate = dayjs('2025-04-22');
    
    const result = calculateInterest(entry, startDate, endDate);
    
    // User expects 735 days (inclusive counting)
    // Expected: 1000000 * 0.036 * (735 / effective_year_basis) = 72394.38
    expect(result).toBeCloseTo(72394.38, 2);
  });

  test('should calculate correct days for 19.04.2023 to 22.04.2025 period (edge case)', () => {
    const entry = {
      bankName: 'Test Bank',
      kontoNumber: '12345',
      startDatum: dayjs('2023-04-19'),
      endDatum: dayjs('2025-04-22'),
      nominal: 1000000,
      zinssatz: 3.6
    };
    const startDate = dayjs('2023-04-19');
    const endDate = dayjs('2025-04-22');
    
    const result = calculateInterest(entry, startDate, endDate);
    
    // Manual calculation: Should be 735 days (inclusive counting)
    // From 19.04.2023 to 22.04.2025 using inclusive counting
    // Expected: 1000000 * 0.036 * (735 / weighted_year_basis) = 72394.38
    expect(result).toBeCloseTo(72394.38, 2);
  });
});

// Export for potential use in other test files
export { calculateInterest };
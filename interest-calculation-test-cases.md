# Interest Calculation Test Cases

## Overview
This document outlines comprehensive test cases for the interest calculation function, with special focus on leap year handling and edge cases.

## Current Formula
```
Interest = Principal × (Rate / 100) × (Days / YearBasis)
```

## Test Categories

### 1. Basic Functionality Tests

#### 1.1 Simple Interest Calculation
- **Test Case**: Standard 365-day year calculation
- **Input**: €1000, 5% rate, 01.01.2023 to 31.12.2023 (365 days)
- **Expected**: €50.00
- **Formula**: 1000 × 0.05 × (365/365) = 50

#### 1.2 Partial Year Calculation
- **Test Case**: Half year calculation
- **Input**: €1000, 5% rate, 01.01.2023 to 01.07.2023 (181 days)
- **Expected**: €24.79
- **Formula**: 1000 × 0.05 × (181/365) = 24.79

### 2. Leap Year Tests

#### 2.1 Full Leap Year Period
- **Test Case**: Full leap year (366 days)
- **Input**: €1000, 5% rate, 01.01.2024 to 31.12.2024 (366 days)
- **Expected**: €50.14 (using 366-day basis)
- **Formula**: 1000 × 0.05 × (366/366) = 50.00

#### 2.2 Leap Year February 29th
- **Test Case**: Period including Feb 29th
- **Input**: €1000, 5% rate, 01.02.2024 to 01.03.2024 (29 days)
- **Expected**: €3.96 (using 366-day basis)
- **Formula**: 1000 × 0.05 × (29/366) = 3.96

#### 2.3 Non-Leap Year February
- **Test Case**: Same period in non-leap year
- **Input**: €1000, 5% rate, 01.02.2023 to 01.03.2023 (28 days)
- **Expected**: €3.84 (using 365-day basis)
- **Formula**: 1000 × 0.05 × (28/365) = 3.84

#### 2.4 Cross-Year Period (Leap to Non-Leap)
- **Test Case**: From leap year to non-leap year
- **Input**: €1000, 5% rate, 01.12.2024 to 31.01.2025 (61 days)
- **Expected**: Weighted average year basis calculation
- **Notes**: 31 days in 2024 (366-day year) + 30 days in 2025 (365-day year)

#### 2.5 Cross-Year Period (Non-Leap to Leap)
- **Test Case**: From non-leap year to leap year
- **Input**: €1000, 5% rate, 01.12.2023 to 31.01.2024 (61 days)
- **Expected**: Weighted average year basis calculation
- **Notes**: 31 days in 2023 (365-day year) + 30 days in 2024 (366-day year)

### 3. Multi-Year Period Tests

#### 3.1 Two Full Years (Both Non-Leap)
- **Test Case**: 2022-2023 (both 365 days)
- **Input**: €1000, 5% rate, 01.01.2022 to 31.12.2023 (730 days)
- **Expected**: €100.00
- **Formula**: 1000 × 0.05 × (730/365) = 100.00

#### 3.2 Two Full Years (One Leap, One Non-Leap)
- **Test Case**: 2023-2024 (365 + 366 days)
- **Input**: €1000, 5% rate, 01.01.2023 to 31.12.2024 (731 days)
- **Expected**: Weighted calculation
- **Notes**: (365×365 + 366×366) / 731 = 365.5 effective year basis

#### 3.3 Three Years Including Leap Year
- **Test Case**: 2023-2025 period
- **Input**: €1000, 5% rate, 01.01.2023 to 31.12.2025
- **Expected**: Complex weighted calculation

### 4. Edge Cases - Date Boundaries

#### 4.1 Same Day Period
- **Test Case**: Start and end on same day
- **Input**: €1000, 5% rate, 01.01.2024 to 01.01.2024 (0 days)
- **Expected**: €0.00

#### 4.2 One Day Period
- **Test Case**: Single day interest
- **Input**: €1000, 5% rate, 01.01.2024 to 02.01.2024 (1 day)
- **Expected**: €0.14 (using 366-day basis for 2024)
- **Formula**: 1000 × 0.05 × (1/366) = 0.137

#### 4.3 Year-End to Year-Start
- **Test Case**: Cross New Year boundary
- **Input**: €1000, 5% rate, 31.12.2023 to 01.01.2024 (1 day)
- **Expected**: Depends on implementation - which year basis to use?

#### 4.4 Leap Day Specific
- **Test Case**: Starting on Feb 29th
- **Input**: €1000, 5% rate, 29.02.2024 to 01.03.2024 (1 day)
- **Expected**: €0.14 (using 366-day basis)

#### 4.5 End on Leap Day
- **Test Case**: Ending on Feb 29th
- **Input**: €1000, 5% rate, 28.02.2024 to 29.02.2024 (1 day)
- **Expected**: €0.14 (using 366-day basis)

### 5. Century Leap Year Tests

#### 5.1 Century Year (Not Leap)
- **Test Case**: Year 1900 (not a leap year)
- **Input**: €1000, 5% rate, 01.01.1900 to 31.12.1900 (365 days)
- **Expected**: €50.00

#### 5.2 Century Year (Leap)
- **Test Case**: Year 2000 (is a leap year)
- **Input**: €1000, 5% rate, 01.01.2000 to 31.12.2000 (366 days)
- **Expected**: €50.00 (using 366-day basis)

### 6. Rounding and Precision Tests

#### 6.1 Rounding to Cents
- **Test Case**: Result requiring rounding
- **Input**: €1000, 3.333% rate, 100 days in 365-day year
- **Expected**: Proper rounding to 2 decimal places
- **Formula**: 1000 × 0.03333 × (100/365) = 9.132... → €9.13

#### 6.2 Very Small Amounts
- **Test Case**: Minimal interest calculation
- **Input**: €0.01, 1% rate, 1 day in 365-day year
- **Expected**: €0.00 (rounds to zero)

#### 6.3 Very Large Amounts
- **Test Case**: Large principal
- **Input**: €1,000,000, 5% rate, 365 days
- **Expected**: €50,000.00

### 7. Rate Edge Cases

#### 7.1 Zero Interest Rate
- **Test Case**: 0% interest rate
- **Input**: €1000, 0% rate, any period
- **Expected**: €0.00

#### 7.2 Very High Interest Rate
- **Test Case**: 100% interest rate
- **Input**: €1000, 100% rate, 365 days in 365-day year
- **Expected**: €1000.00

#### 7.3 Fractional Interest Rate
- **Test Case**: Precise decimal rate
- **Input**: €1000, 2.5% rate, 365 days
- **Expected**: €25.00

### 8. Quarterly Calculation Tests

#### 8.1 Q1 in Leap Year
- **Test Case**: Q1 2024 (Jan-Mar)
- **Input**: €1000, 5% rate, 01.01.2024 to 31.03.2024 (91 days)
- **Expected**: €12.43 (using 366-day basis)

#### 8.2 Q1 in Non-Leap Year
- **Test Case**: Q1 2023 (Jan-Mar)
- **Input**: €1000, 5% rate, 01.01.2023 to 31.03.2023 (90 days)
- **Expected**: €12.33 (using 365-day basis)

#### 8.3 Q4 Cross-Year
- **Test Case**: Q4 spanning two years
- **Input**: €1000, 5% rate, 01.10.2024 to 31.12.2024 (92 days)
- **Expected**: €12.57 (using 366-day basis)

### 9. Business Logic Edge Cases

#### 9.1 Future Dates
- **Test Case**: End date before start date
- **Input**: €1000, 5% rate, 31.12.2024 to 01.01.2024
- **Expected**: Error or negative result?

#### 9.2 Very Long Periods
- **Test Case**: 10-year period
- **Input**: €1000, 5% rate, 01.01.2020 to 31.12.2029
- **Expected**: Complex multi-year calculation with multiple leap years

### 10. Real-World Scenarios

#### 10.1 Account Opening Mid-Year
- **Test Case**: Account opened July 15th
- **Input**: €5000, 3.5% rate, 15.07.2024 to 31.12.2024
- **Expected**: Accurate partial year calculation

#### 10.2 Account Closing Early
- **Test Case**: Account closed before maturity
- **Input**: €10000, 4% rate, 01.01.2024 to 15.06.2024
- **Expected**: Accurate partial period calculation

#### 10.3 Interest Rate Change
- **Test Case**: Rate changes during period (if applicable)
- **Notes**: May require separate calculations for different rate periods

## Implementation Notes

### Year Basis Calculation Methods
1. **Simple Method**: Use start year's day count (365 or 366)
2. **Weighted Average Method**: Calculate weighted average for multi-year periods
3. **Actual/Actual Method**: Use actual days in actual year for each portion

### Recommended Test Data Structure
```javascript
{
  testName: "Description",
  principal: 1000,
  rate: 5.0,
  startDate: "2024-01-01",
  endDate: "2024-12-31",
  expectedInterest: 50.00,
  yearBasis: 366,
  notes: "Additional context"
}
```

### Critical Test Scenarios to Prioritize
1. Feb 29th inclusion/exclusion
2. Cross-year calculations
3. Rounding precision
4. Multi-year weighted averages
5. Century year boundaries (1900, 2000, 2100)

## Validation Checklist
- [ ] All leap year scenarios covered
- [ ] Rounding behaves consistently
- [ ] Edge dates (year boundaries) handled correctly
- [ ] Multi-year calculations use proper weighting
- [ ] Century leap year rules applied correctly
- [ ] Quarterly calculations align with annual calculations
- [ ] Zero and extreme values handled gracefully
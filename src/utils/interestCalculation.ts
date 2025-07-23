import dayjs, { Dayjs } from "dayjs";

export interface KontoData {
  bankName: string;
  kontoNumber: string;
  startDatum: Dayjs;
  endDatum: Dayjs;
  zinssatz: number;
  nominal: number;
  zinsen?: number;
  kommulierteZinsen?: number;
  quarterlyZinsen?: number;
  verbuchteRueckstellung?: number;
  kommulierteSumme?: number;
}

export const calculateInterest = (
  entry: KontoData,
  pStartDatum: Dayjs,
  pEndDatum: Dayjs,
) => {
  console.log("calculateInterest called with:", {
    bankName: entry.bankName,
    kontoNumber: entry.kontoNumber,
    startDatum: pStartDatum.format("DD.MM.YYYY"),
    endDatum: pEndDatum.format("DD.MM.YYYY"),
    nominal: entry.nominal,
    zinssatz: entry.zinssatz,
  });
  
  const days = pEndDatum.diff(pStartDatum, "day");
  
  console.log(
    `Calculation: days = ${pEndDatum.format("DD.MM.YYYY")} - ${pStartDatum.format("DD.MM.YYYY")} (effektiv für ${pStartDatum.format("DD.MM.YYYY")}) = ${days} days`,
  );
  
  // Calculate effective year basis for the period
  const effectiveYearBasis = calculateEffectiveYearBasis(pStartDatum, pEndDatum);
  
  const interest = entry.nominal * (entry.zinssatz / 100) * (days / effectiveYearBasis);
  const roundedInterest = Math.round(interest * 100) / 100;
  
  console.log(
    `Calculation: interest = ${entry.nominal} * (${entry.zinssatz} / 100) * (${days} / ${effectiveYearBasis}) = ${interest}`,
  );
  console.log(
    `Calculation: roundedInterest = Math.round(${interest} * 100) / 100 = ${roundedInterest}`,
  );
  
  return roundedInterest;
};

/**
 * Calculate the effective year basis for a given period.
 * For single-year periods, uses the year's actual day count.
 * For multi-year periods, calculates a weighted average based on actual days in each year.
 */
function calculateEffectiveYearBasis(startDate: Dayjs, endDate: Dayjs): number {
  const startYear = startDate.year();
  const endYear = endDate.year();
  
  // Single year period - use that year's day count
  if (startYear === endYear) {
    return startDate.isLeapYear() ? 366 : 365;
  }
  
  // Multi-year period - calculate weighted average
  let totalDays = 0;
  let weightedYearDays = 0;
  
  let currentDate = startDate;
  
  while (currentDate.year() <= endYear) {
    const currentYear = currentDate.year();
    const yearDays = dayjs(`${currentYear}-01-01`).isLeapYear() ? 366 : 365;
    
    let yearStartInPeriod: Dayjs;
    let yearEndInPeriod: Dayjs;
    
    if (currentYear === startYear) {
      // First year: from start date to end of year
      yearStartInPeriod = currentDate;
      yearEndInPeriod = dayjs(`${currentYear}-12-31`).add(1, 'day'); // End of year + 1 day for diff calculation
      if (yearEndInPeriod.isAfter(endDate)) {
        yearEndInPeriod = endDate;
      }
    } else if (currentYear === endYear) {
      // Last year: from start of year to end date
      yearStartInPeriod = dayjs(`${currentYear}-01-01`);
      yearEndInPeriod = endDate;
    } else {
      // Middle year: full year
      yearStartInPeriod = dayjs(`${currentYear}-01-01`);
      yearEndInPeriod = dayjs(`${currentYear}-12-31`).add(1, 'day'); // End of year + 1 day for diff calculation
    }
    
    const daysInThisYear = yearEndInPeriod.diff(yearStartInPeriod, 'day');
    totalDays += daysInThisYear;
    weightedYearDays += daysInThisYear * yearDays;
    
    currentDate = dayjs(`${currentYear + 1}-01-01`);
  }
  
  // Return weighted average year basis
  return totalDays > 0 ? weightedYearDays / totalDays : 365;
}
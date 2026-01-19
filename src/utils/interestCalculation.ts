import dayjs, { Dayjs } from "dayjs";

export type DayCountConvention = "actual" | "30/360";

export interface KontoData {
  bankName: string;
  kontoNumber: string;
  startDatum: Dayjs;
  endDatum: Dayjs;
  zinssatz: number;
  nominal: number;
  dayCountConvention?: DayCountConvention;
  zinsen?: number;
  kommulierteZinsen?: number;
  quarterlyZinsen?: number;
  verbuchteRueckstellung?: number;
  kommulierteSumme?: number;
}

function calculate30360Days(startDate: Dayjs, endDate: Dayjs): number {
  let d1 = startDate.date();
  let m1 = startDate.month() + 1;
  let y1 = startDate.year();

  let d2 = endDate.date();
  let m2 = endDate.month() + 1;
  let y2 = endDate.year();

  if (d1 === 31) d1 = 30;
  if (d2 === 31) d2 = 30;

  return (y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1) + 1;
}

export const calculateInterest = (
  entry: KontoData,
  pStartDatum: Dayjs,
  pEndDatum: Dayjs
) => {
  const convention = entry.dayCountConvention || "actual";

  console.log("calculateInterest called with:", {
    bankName: entry.bankName,
    kontoNumber: entry.kontoNumber,
    startDatum: pStartDatum.format("DD.MM.YYYY"),
    endDatum: pEndDatum.format("DD.MM.YYYY"),
    nominal: entry.nominal,
    zinssatz: entry.zinssatz,
    dayCountConvention: convention,
  });

  let days: number;
  let yearBasis: number;

  if (convention === "30/360") {
    days = calculate30360Days(pStartDatum, pEndDatum);
    yearBasis = 360;
  } else {
    days = pEndDatum.diff(pStartDatum, "day") + 1;
    yearBasis = calculateEffectiveYearBasis(pStartDatum, pEndDatum);
  }

  if (days <= 0) {
    console.log(`Calculation: days = ${days} (invalid period) = 0 interest`);
    return 0.0;
  }

  console.log(
    `Calculation: days = ${pEndDatum.format("DD.MM.YYYY")} - ${pStartDatum.format("DD.MM.YYYY")} = ${days} days (${convention})`
  );

  const interest = entry.nominal * (entry.zinssatz / 100) * (days / yearBasis);
  const roundedInterest = Math.round(interest * 100) / 100;

  console.log(
    `Calculation: interest = ${entry.nominal} * (${entry.zinssatz} / 100) * (${days} / ${yearBasis}) = ${interest}`
  );
  console.log(
    `Calculation: roundedInterest = Math.round(${interest} * 100) / 100 = ${roundedInterest}`
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
      yearEndInPeriod = dayjs(`${currentYear}-12-31`).add(1, "day"); // End of year + 1 day for diff calculation
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
      yearEndInPeriod = dayjs(`${currentYear}-12-31`).add(1, "day"); // End of year + 1 day for diff calculation
    }

    // Use consistent inclusive day calculation for all years
    const daysInThisYear = yearEndInPeriod.diff(yearStartInPeriod, "day") + 1;
    totalDays += daysInThisYear;
    weightedYearDays += daysInThisYear * yearDays;

    currentDate = dayjs(`${currentYear + 1}-01-01`);
  }

  // Return weighted average year basis
  return totalDays > 0 ? weightedYearDays / totalDays : 365;
}

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
  
  const yearDays = pStartDatum.isLeapYear() ? 366 : 365;
  const days = pEndDatum.diff(pStartDatum, "day");
  
  console.log(
    `Calculation: days = ${pEndDatum.format("DD.MM.YYYY")} - ${pStartDatum.format("DD.MM.YYYY")} (effektiv für ${pStartDatum.format("DD.MM.YYYY")}) = ${days} days`,
  );
  
  const interest = entry.nominal * (entry.zinssatz / 100) * (days / yearDays);
  const roundedInterest = Math.round(interest * 100) / 100;
  
  console.log(
    `Calculation: interest = ${entry.nominal} * (${entry.zinssatz} / 100) * (${days} / ${yearDays}) = ${interest}`,
  );
  console.log(
    `Calculation: roundedInterest = Math.round(${interest} * 100) / 100 = ${roundedInterest}`,
  );
  
  return roundedInterest;
};
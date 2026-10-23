import dayjs, { Dayjs } from "dayjs";
import isLeapYear from "dayjs/plugin/isLeapYear";
import { calculateInterest } from "./interestCalculation";
import type { DayCountConvention, KontoData } from "./interestCalculation";

dayjs.extend(isLeapYear);

/**
 * Prognose-/Szenario-Engine
 * -------------------------------------------------------------------------
 * Baut auf `interestCalculation.ts` auf und verändert die bestehende
 * Berechnung nicht. Annahmen (bewusst einfach und nachvollziehbar):
 *
 *  1. Laufende Anlagen verzinsen sich bis zum vertraglichen Enddatum mit dem
 *     vertraglich vereinbarten Zinssatz (Zinsbindung wird nicht gebrochen).
 *  2. Bei Fälligkeit wird das Nominal (anteilig, siehe `reinvestShare`) erneut
 *     angelegt – zum Marktzins des Szenarios am Wiederanlagetag.
 *  3. Die Zinsen werden nicht kapitalisiert (kein Zinseszinseffekt), weil der
 *     Zinsrechner Zinsen getrennt als Abgrenzung (KTO 2301) führt.
 *  4. Die Wiederanlage läuft über die Ursprungslaufzeit, sofern keine andere
 *     Laufzeit vorgegeben wird.
 */

export type ScenarioKind = "linear" | "steps" | "perYear";

export interface RateStep {
  /** Ab diesem Datum gilt `ratePp` (bis zum nächsten Schritt). */
  from: Dayjs | string;
  /** Marktzins in Prozent (nicht Basispunkte). */
  ratePp: number;
}

export interface RateScenario {
  kind: ScenarioKind;
  /** Marktzins am Prognosebeginn in Prozent, z. B. 2.5 */
  baseRatePp: number;
  /** Nur bei kind === "linear": Veränderung in Prozentpunkten pro Jahr */
  changePpPerYear?: number;
  /** Nur bei kind === "steps": absolute Zinsniveaus mit Startdatum */
  steps?: RateStep[];
  /**
   * Nur bei kind === "perYear": Marktzins je Kalenderjahr in Prozent, z. B.
   * `{ 2025: 2.5, 2026: 2.5, 2027: 3 }`. Fehlt ein Jahr, gilt `baseRatePp`.
   */
  yearRatesPp?: Record<number, number>;
  /** Parallelverschiebung der gesamten Kurve (Zinsschock), z. B. +1 (= +100 bp) */
  shiftPp?: number;
  minRatePp?: number;
  maxRatePp?: number;
}

export interface ForecastOptions {
  /** Stichtag, ab dem prognostiziert wird */
  start: Dayjs | string;
  /** Prognosehorizont in Jahren (Standard 5) */
  horizonYears?: number;
  scenario: RateScenario;
  /** Anteil des fälligen Nominals, der wieder angelegt wird (0..1), Standard 1 */
  reinvestShare?: number;
  /** Laufzeit der Wiederanlage in Monaten; null = Ursprungslaufzeit */
  reinvestTermMonths?: number | null;
  /** Bereits abgelaufene Anlagen als wiederangelegt mitführen (Standard false) */
  includeExpired?: boolean;
}

export interface ForecastYearRow {
  year: number;
  /** Zinsertrag des Kalenderjahres in € */
  interest: number;
  /** Kumulierter Zinsertrag seit Prognosebeginn in € */
  cumulativeInterest: number;
  /** Nominal zum 01.01. des Jahres in € */
  nominalStart: number;
  /** Nominal zum 31.12. des Jahres in € */
  nominalEnd: number;
  /** Im Jahr fällig gewordenes Nominal in € */
  expiringNominal: number;
  /** Im Jahr wiederangelegtes Nominal in € */
  reinvestedNominal: number;
  /** nach Nominal und Tagen gewichteter Durchschnittszins in % */
  averageRatePp: number;
}

export interface ForecastResult {
  fromYear: number;
  toYear: number;
  rows: ForecastYearRow[];
  /** Summe der Zinsen über den gesamten Horizont in € */
  totalInterest: number;
  /** Durchschnittliche Verzinsung über den Horizont in % */
  averageRatePp: number;
  /** Nominal zum Ende des Horizonts in € */
  nominalAtEnd: number;
}

interface Leg {
  from: Dayjs;
  to: Dayjs;
  nominal: number;
  ratePp: number;
  convention: DayCountConvention;
  kind: "contract" | "reinvest";
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MS_PER_YEAR = 365.25 * DAY_MS;

function toDay(value: Dayjs | string): Dayjs {
  return dayjs(value).startOf("day");
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Marktzins des Szenarios zu einem Zeitpunkt in Prozent. */
export function resolveRatePp(
  scenario: RateScenario,
  date: Dayjs | string,
  anchor: Dayjs | string,
): number {
  const day = toDay(date);
  const baseDay = toDay(anchor);
  const min = scenario.minRatePp ?? -5;
  const max = scenario.maxRatePp ?? 25;

  let rate: number;
  if (scenario.kind === "perYear") {
    const table = scenario.yearRatesPp ?? {};
    const exact = table[day.year()];
    rate = typeof exact === "number" ? exact : scenario.baseRatePp;
  } else if (scenario.kind === "steps" && scenario.steps && scenario.steps.length > 0) {
    const sorted = [...scenario.steps].sort(
      (a, b) => toDay(a.from).valueOf() - toDay(b.from).valueOf(),
    );
    rate = scenario.baseRatePp;
    for (const step of sorted) {
      if (!toDay(step.from).isAfter(day, "day")) {
        rate = step.ratePp;
      }
    }
  } else {
    const years = Math.max(0, day.valueOf() - baseDay.valueOf()) / MS_PER_YEAR;
    rate = scenario.baseRatePp + (scenario.changePpPerYear ?? 0) * years;
  }

  rate += scenario.shiftPp ?? 0;
  return Math.min(max, Math.max(min, rate));
}

/** Zerlegt einen Zeitraum an Jahresgrenzen (inklusive Zählweise, keine Überschneidung). */function splitByCalendarYear(from: Dayjs, to: Dayjs): { from: Dayjs; to: Dayjs }[] {
  const segments: { from: Dayjs; to: Dayjs }[] = [];
  let cursor = toDay(from);
  const end = toDay(to);
  let guard = 0;

  while (!cursor.isAfter(end, "day") && guard++ < 400) {
    const yearEnd = cursor.endOf("year").startOf("day");
    const segmentEnd = yearEnd.isAfter(end, "day") ? end : yearEnd;
    segments.push({ from: cursor, to: segmentEnd });
    cursor = segmentEnd.add(1, "day");
  }

  return segments;
}

/**
 * Vertragslaufzeit in ganzen Monaten. Der Endtag zählt mit, deshalb wird
 * `endDatum + 1 Tag` gemessen: 01.01.–31.12. ergibt 12 Monate statt 11.
 */
function termMonths(from: Dayjs, to: Dayjs): number {
  return Math.max(1, toDay(to).add(1, "day").diff(toDay(from), "month"));
}

/**
 * Erzeugt die Zinsperioden ("legs") aller Anlagen über den Horizont:
 * vertragliche Laufzeit, danach rollierende Wiederanlage zum Szenariozins.
 */
function buildLegs(accounts: KontoData[], opts: ForecastOptions): Leg[] {
  const start = toDay(opts.start);
  const horizonYears = Math.max(1, Math.floor(opts.horizonYears ?? 5));
  const horizonEnd = start.add(horizonYears, "year").subtract(1, "day");
  const reinvestShare = Math.min(1, Math.max(0, opts.reinvestShare ?? 1));
  const legs: Leg[] = [];

  for (const account of accounts) {
    const convention = account.dayCountConvention || "actual";
    const originalTerm = termMonths(account.startDatum, account.endDatum);

    let nominal = account.nominal;
    let ratePp = account.zinssatz;
    let legStart: Dayjs;
    let legEnd: Dayjs;
    let kind: Leg["kind"] = "contract";

    if (toDay(account.endDatum).isBefore(start, "day")) {
      if (!opts.includeExpired) continue;
      kind = "reinvest";
      nominal = account.nominal * reinvestShare;
      legStart = start;
      ratePp = resolveRatePp(opts.scenario, start, start);
      legEnd = legStart
        .add(opts.reinvestTermMonths ?? originalTerm, "month")
        .subtract(1, "day");
    } else {
      legStart = toDay(account.startDatum).isBefore(start, "day")
        ? start
        : toDay(account.startDatum);
      legEnd = toDay(account.endDatum);
    }

    let guard = 0;
    while (!legStart.isAfter(horizonEnd, "day") && nominal > 0 && guard++ < 200) {
      const clippedEnd = legEnd.isAfter(horizonEnd, "day") ? horizonEnd : legEnd;
      legs.push({
        from: legStart,
        to: clippedEnd,
        nominal,
        ratePp,
        convention,
        kind,
      });

      if (legEnd.isAfter(horizonEnd, "day")) break;

      // Nächste Periode: Wiederanlage zum Szenariozins ab dem Folgetag.
      legStart = legEnd.add(1, "day");
      legEnd = legStart
        .add(opts.reinvestTermMonths ?? originalTerm, "month")
        .subtract(1, "day");
      nominal = kind === "contract" ? account.nominal * reinvestShare : nominal;
      ratePp = resolveRatePp(opts.scenario, legStart, start);
      kind = "reinvest";

      if (nominal <= 0) break;
    }
  }

  return legs;
}

/** Nominal, das an einem Stichtag angelegt ist. */
function nominalAt(legs: Leg[], date: Dayjs): number {
  return legs.reduce(
    (sum, leg) =>
      !date.isBefore(leg.from, "day") && !date.isAfter(leg.to, "day")
        ? sum + leg.nominal
        : sum,
    0,
  );
}

/**
 * Erstellt die 5-Jahres-Prognose (bzw. den gewählten Horizont) für die
 * übergebenen Anlagen unter dem angegebenen Zinsszenario.
 */
export function forecast(
  accounts: KontoData[],
  opts: ForecastOptions,
): ForecastResult {
  const start = toDay(opts.start);
  const horizonYears = Math.max(1, Math.floor(opts.horizonYears ?? 5));
  const horizonEnd = start.add(horizonYears, "year").subtract(1, "day");
  const legs = buildLegs(accounts, { ...opts, horizonYears });

  const fromYear = start.year();
  const toYear = horizonEnd.year();
  const buckets = new Map<
    number,
    {
      interest: number;
      rateWeight: number;
      dayWeight: number;
      expiringNominal: number;
      reinvestedNominal: number;
    }
  >();

  for (let year = fromYear; year <= toYear; year += 1) {
    buckets.set(year, {
      interest: 0,
      rateWeight: 0,
      dayWeight: 0,
      expiringNominal: 0,
      reinvestedNominal: 0,
    });
  }

  for (const leg of legs) {
    const bucketEnd = buckets.get(leg.to.year());
    // Fälligkeiten am Horizontende sind keine echte Fälligkeit im Bestand.
    if (bucketEnd && !leg.to.isSame(horizonEnd, "day")) {
      bucketEnd.expiringNominal += leg.nominal;
    }
    if (leg.kind === "reinvest") {
      const bucketStart = buckets.get(leg.from.year());
      if (bucketStart) bucketStart.reinvestedNominal += leg.nominal;
    }

    const pseudoEntry = {
      nominal: leg.nominal,
      zinssatz: leg.ratePp,
      dayCountConvention: leg.convention,
    } as KontoData;

    for (const segment of splitByCalendarYear(leg.from, leg.to)) {
      const bucket = buckets.get(segment.from.year());
      if (!bucket) continue;
      const days = segment.to.diff(segment.from, "day") + 1;
      bucket.interest += calculateInterest(pseudoEntry, segment.from, segment.to);
      bucket.rateWeight += leg.nominal * leg.ratePp * days;
      bucket.dayWeight += leg.nominal * days;
    }
  }

  let cumulativeInterest = 0;
  let weightedRateTotal = 0;
  let dayWeightTotal = 0;
  const rows: ForecastYearRow[] = [];

  for (let year = fromYear; year <= toYear; year += 1) {
    const bucket = buckets.get(year)!;
    const interest = round2(bucket.interest);
    cumulativeInterest = round2(cumulativeInterest + interest);
    weightedRateTotal += bucket.rateWeight;
    dayWeightTotal += bucket.dayWeight;

    rows.push({
      year,
      interest,
      cumulativeInterest,
      nominalStart: round2(nominalAt(legs, dayjs(`${year}-01-01`))),
      nominalEnd: round2(nominalAt(legs, dayjs(`${year}-12-31`))),
      expiringNominal: round2(bucket.expiringNominal),
      reinvestedNominal: round2(bucket.reinvestedNominal),
      averageRatePp:
        bucket.dayWeight > 0
          ? Math.round((bucket.rateWeight / bucket.dayWeight) * 10000) / 10000
          : 0,
    });
  }

  return {
    fromYear,
    toYear,
    rows,
    totalInterest: round2(rows.reduce((sum, row) => sum + row.interest, 0)),
    averageRatePp:
      dayWeightTotal > 0
        ? Math.round((weightedRateTotal / dayWeightTotal) * 10000) / 10000
        : 0,
    nominalAtEnd: nominalAt(legs, horizonEnd),
  };
}

export interface ForecastBandEntry {
  label: string;
  result: ForecastResult;
  deltaToBase: number;
}

export interface ForecastBandResult {
  base: ForecastResult;
  entries: ForecastBandEntry[];
}

/**
 * Bandbreite: rechnet dasselbe Szenario mit einer Parallelverschiebung nach
 * unten/oben (Standard ±100 bp) und liefert die Abweichung zum Basisfall.
 */
export function forecastBand(
  accounts: KontoData[],
  opts: ForecastOptions,
  spreadPp = 1,
): ForecastBandResult {
  const base = forecast(accounts, opts);
  const entries: ForecastBandEntry[] = [
    {
      label: `Zinsen −${spreadPp} pp`,
      result: forecast(accounts, {
        ...opts,
        scenario: { ...opts.scenario, shiftPp: (opts.scenario.shiftPp ?? 0) - spreadPp },
      }),
      deltaToBase: 0,
    },
    {
      label: `Zinsen +${spreadPp} pp`,
      result: forecast(accounts, {
        ...opts,
        scenario: { ...opts.scenario, shiftPp: (opts.scenario.shiftPp ?? 0) + spreadPp },
      }),
      deltaToBase: 0,
    },
  ];

  entries.forEach((entry) => {
    entry.deltaToBase = round2(entry.result.totalInterest - base.totalInterest);
  });

  return { base, entries };
}

/**
 * Fertige Szenario-Vorlagen für die UI (Basiszinssatz = heutiger Marktzins).
 * `start` verankert die Stufen-Szenarien am Prognosebeginn (Standard: heute),
 * damit dieselbe Vorlage reproduzierbare Ergebnisse liefert.
 */
export function scenarioPresets(
  baseRatePp: number,
  start: Dayjs | string = dayjs(),
): {
  key: string;
  label: string;
  scenario: RateScenario;
}[] {
  const anchor = toDay(start);
  return [
    {
      key: "constant",
      label: "Zins bleibt konstant",
      scenario: { kind: "linear", baseRatePp, changePpPerYear: 0 },
    },
    {
      key: "rising",
      label: "Zins steigt (+0,5 pp pro Jahr)",
      scenario: { kind: "linear", baseRatePp, changePpPerYear: 0.5 },
    },
    {
      key: "falling",
      label: "Zins fällt (−0,5 pp pro Jahr)",
      scenario: { kind: "linear", baseRatePp, changePpPerYear: -0.5 },
    },
    {
      key: "shock-up",
      label: "Zinsschock +2 pp (ab sofort)",
      scenario: {
        kind: "steps",
        baseRatePp,
        steps: [{ from: anchor, ratePp: baseRatePp + 2 }],
      },
    },
    {
      key: "normalisation",
      label: "Rückkehr auf 3,0 % in 2 Jahren",
      scenario: {
        kind: "steps",
        baseRatePp,
        steps: [
          { from: anchor, ratePp: baseRatePp },
          { from: anchor.add(1, "year"), ratePp: (baseRatePp + 3) / 2 },
          { from: anchor.add(2, "year"), ratePp: 3 },
        ],
      },
    },
  ];
}

/** Durchschnittlicher Zinssatz des aktuellen Bestands, gewichtet nach Nominal. */
export function currentAverageRatePp(accounts: KontoData[]): number {
  const total = accounts.reduce((sum, account) => sum + account.nominal, 0);
  if (total <= 0) return 0;
  const weighted = accounts.reduce(
    (sum, account) => sum + account.nominal * account.zinssatz,
    0,
  );
  return Math.round((weighted / total) * 10000) / 10000;
}

/**
 * Ablaufendes Nominal je Kalenderjahr.
 * ---------------------------------------------------------------------------
 * Summe der Nominale, deren Veranlagung im jeweiligen Jahr fällig wird
 * (`endDatum`). Bereits vor dem Stichtag abgelaufene Veranlagungen zählen nicht
 * mehr; Jahre ohne Fälligkeit liefern 0. Nur diese Beträge stehen für eine
 * Wiederanlage zur Verfügung und gehen in die Prognose der Aufteilung ein.
 */
export function expiringNominalByYear(
  accounts: KontoData[],
  start: Dayjs | string,
  years: number[],
): number[] {
  const anchor = dayjs(start).startOf("day");
  return years.map((year) => {
    const sum = accounts.reduce((total, account) => {
      const end = dayjs(account.endDatum).startOf("day");
      if (end.year() !== year || end.isBefore(anchor, "day")) {
        return total;
      }
      return total + account.nominal;
    }, 0);
    return Math.round(sum * 100) / 100;
  });
}

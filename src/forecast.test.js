/**
 * Tests für die Prognose-Engine (5-Jahres-Szenarien).
 *
 * Ausführen: npx vitest run src/forecast.test.js
 */

import { describe, test, expect } from "vitest";
import dayjs from "dayjs";
import isLeapYear from "dayjs/plugin/isLeapYear";
import { calculateInterest } from "./utils/interestCalculation";
import {
  forecast,
  forecastBand,
  resolveRatePp,
  currentAverageRatePp,
  expiringNominalByYear,
  scenarioPresets,
} from "./utils/forecast";

dayjs.extend(isLeapYear);

const konto = (overrides = {}) => ({
  bankName: "Testbank",
  kontoNumber: "123",
  startDatum: dayjs("2025-01-01"),
  endDatum: dayjs("2025-12-31"),
  zinssatz: 3,
  nominal: 100000,
  dayCountConvention: "actual",
  ...overrides,
});

const konstant = (baseRatePp = 2) => ({
  kind: "linear",
  baseRatePp,
  changePpPerYear: 0,
});

const baseOptions = (overrides = {}) => ({
  start: dayjs("2025-01-01"),
  horizonYears: 5,
  scenario: konstant(2),
  reinvestShare: 1,
  ...overrides,
});

describe("Prognose: Grundfälle", () => {
  test("Ein-Jahres-Anlage wird zum Szenariozins wiederangelegt", () => {
    const result = forecast([konto()], baseOptions());

    expect(result.fromYear).toBe(2025);
    expect(result.toYear).toBe(2029);
    expect(result.rows).toHaveLength(5);

    // 2025: vertraglich 3 % auf 100.000 €
    expect(result.rows[0].interest).toBeCloseTo(3000, 2);
    // 2026-2029: Wiederanlage zu 2 %
    [1, 2, 3, 4].forEach((index) => {
      expect(result.rows[index].interest).toBeCloseTo(2000, 2);
    });

    expect(result.totalInterest).toBeCloseTo(11000, 2);
    expect(result.nominalAtEnd).toBeCloseTo(100000, 2);
    expect(result.rows[0].expiringNominal).toBeCloseTo(100000, 2);
    expect(result.rows[4].expiringNominal).toBe(0); // Horizontende ist keine Fälligkeit
  });

  test("Ohne Wiederanlage entfällt der Zins nach Fälligkeit", () => {
    const result = forecast([konto()], baseOptions({ reinvestShare: 0 }));

    expect(result.rows[0].interest).toBeCloseTo(3000, 2);
    expect(result.rows[1].interest).toBe(0);
    expect(result.totalInterest).toBeCloseTo(3000, 2);
  });

  test("Teilweise Wiederanlage halbiert das Nominal", () => {
    const result = forecast([konto()], baseOptions({ reinvestShare: 0.5 }));

    expect(result.rows[0].interest).toBeCloseTo(3000, 2);
    expect(result.rows[1].interest).toBeCloseTo(1000, 2);
    expect(result.totalInterest).toBeCloseTo(7000, 2);
    expect(result.nominalAtEnd).toBeCloseTo(50000, 2);
  });

  test("Laufzeit über den Horizont wird abgeschnitten und korrekt verzinst", () => {
    const result = forecast(
      [konto({ endDatum: dayjs("2034-12-31") })],
      baseOptions(),
    );

    result.rows.forEach((row) => expect(row.interest).toBeCloseTo(3000, 2));
    expect(result.totalInterest).toBeCloseTo(15000, 2);
    expect(result.rows.every((row) => row.expiringNominal === 0)).toBe(true);
    expect(result.nominalAtEnd).toBeCloseTo(100000, 2);
  });

  test("Abgelaufene Anlagen werden standardmäßig ignoriert, optional fortgeschrieben", () => {
    const abgelaufen = konto({
      startDatum: dayjs("2023-07-01"),
      endDatum: dayjs("2024-06-30"),
      zinssatz: 4,
      nominal: 50000,
    });

    const ohne = forecast([abgelaufen], baseOptions());
    expect(ohne.totalInterest).toBe(0);

    const mit = forecast(
      [abgelaufen],
      baseOptions({ includeExpired: true, reinvestTermMonths: 12 }),
    );
    expect(mit.totalInterest).toBeCloseTo(5000, 2);
    expect(mit.rows[0].nominalStart).toBeCloseTo(50000, 2);
  });
});

describe("Prognose: Szenarien", () => {
  test("Steigender Zins erhöht den Zinsertrag monoton", () => {
    const steigend = forecast(
      [konto()],
      baseOptions({
        scenario: { kind: "linear", baseRatePp: 2, changePpPerYear: 1 },
      }),
    );

    const reinvestJahre = steigend.rows.slice(1);
    for (let i = 1; i < reinvestJahre.length; i += 1) {
      expect(reinvestJahre[i].interest).toBeGreaterThan(
        reinvestJahre[i - 1].interest,
      );
    }
    expect(steigend.totalInterest).toBeGreaterThan(11000);
    // 2026 liegt praktisch bei 2 % + 1 pp
    expect(steigend.rows[1].averageRatePp).toBeCloseTo(3, 1);
  });

  test("Stufen-Szenario greift ab dem hinterlegten Datum", () => {
    const result = forecast(
      [konto()],
      baseOptions({
        scenario: {
          kind: "steps",
          baseRatePp: 1,
          steps: [{ from: "2027-01-01", ratePp: 5 }],
        },
      }),
    );

    expect(result.rows[0].interest).toBeCloseTo(3000, 2); // vertraglich
    expect(result.rows[1].interest).toBeCloseTo(1000, 2); // 2026: 1 %
    expect(result.rows[2].interest).toBeCloseTo(5000, 2); // 2027: 5 %
    expect(result.totalInterest).toBeCloseTo(19000, 2);
  });

  test("resolveRatePp interpoliert linear und respektiert Grenzen", () => {
    const anchor = dayjs("2025-01-01");
    expect(
      resolveRatePp(
        { kind: "linear", baseRatePp: 2, changePpPerYear: 1 },
        dayjs("2026-01-01"),
        anchor,
      ),
    ).toBeCloseTo(3, 1);

    expect(
      resolveRatePp(
        { kind: "linear", baseRatePp: 24, changePpPerYear: 5 },
        dayjs("2029-01-01"),
        anchor,
      ),
    ).toBe(25);
  });

  test("Bandbreite ±100 bp liefert symmetrische Abweichungen", () => {
    const band = forecastBand([konto()], baseOptions());

    expect(band.base.totalInterest).toBeCloseTo(11000, 2);
    expect(band.entries[0].deltaToBase).toBeCloseTo(-4000, 2);
    expect(band.entries[1].deltaToBase).toBeCloseTo(4000, 2);
  });
});

describe("Prognose: Konsistenz mit der bestehenden Berechnung", () => {
  test("Actual/actual entspricht calculateInterest", () => {
    const entry = konto({
      endDatum: dayjs("2025-06-30"),
      zinssatz: 3.65,
    });
    const result = forecast([entry], baseOptions({ reinvestShare: 0 }));

    expect(result.rows[0].interest).toBeCloseTo(
      calculateInterest(entry, dayjs("2025-01-01"), dayjs("2025-06-30")),
      2,
    );
    expect(result.rows[0].interest).toBeCloseTo(1810, 2);
  });

  test("30/360 entspricht calculateInterest und weicht von actual ab", () => {
    const entry = konto({
      endDatum: dayjs("2025-06-30"),
      zinssatz: 3.65,
      dayCountConvention: "30/360",
    });
    const result = forecast([entry], baseOptions({ reinvestShare: 0 }));

    expect(result.rows[0].interest).toBeCloseTo(
      calculateInterest(entry, dayjs("2025-01-01"), dayjs("2025-06-30")),
      2,
    );
    expect(result.rows[0].interest).toBeCloseTo(1814.86, 2);
  });

  test("Schaltjahr: volles Jahr 2028 ergibt denselben Jahreszins", () => {
    const result = forecast([konto({ endDatum: dayjs("2028-12-31") })], baseOptions());
    expect(result.rows[3].interest).toBeCloseTo(3000, 2);
  });
});

describe("Prognose: Hilfsfunktionen", () => {
  test("currentAverageRatePp gewichtet nach Nominal", () => {
    const average = currentAverageRatePp([
      konto({ nominal: 100000, zinssatz: 1 }),
      konto({ nominal: 300000, zinssatz: 3 }),
    ]);
    expect(average).toBeCloseTo(2.5, 4);
  });

  test("expiringNominalByYear summiert nur Fälligkeiten des jeweiligen Jahres", () => {
    const accounts = [
      konto({ nominal: 500000, endDatum: dayjs("2027-06-30") }),
      konto({ nominal: 200000, endDatum: dayjs("2027-12-31") }),
      konto({ nominal: 1000000, endDatum: dayjs("2026-12-31") }),
      // vor dem Stichtag abgelaufen -> zählt nicht
      konto({ nominal: 999000, endDatum: dayjs("2025-06-30") }),
    ];
    const years = [2025, 2026, 2027, 2028];
    expect(expiringNominalByYear(accounts, dayjs("2026-10-23"), years)).toEqual([
      0, 1000000, 700000, 0,
    ]);
  });

  test("scenarioPresets liefert fünf benannte Szenarien", () => {
    const presets = scenarioPresets(2.5);
    expect(presets).toHaveLength(5);
    expect(presets.map((preset) => preset.key)).toEqual([
      "constant",
      "rising",
      "falling",
      "shock-up",
      "normalisation",
    ]);
    presets.forEach((preset) => expect(preset.label.length).toBeGreaterThan(0));
  });
});

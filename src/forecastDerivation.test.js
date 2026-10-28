import { describe, expect, it } from "vitest";
import dayjs from "dayjs";
import {
  defaultForecastState,
  forecastSplitRows,
  forecastYearAggregates,
  parseForecastState,
} from "./components/ForecastView";

const ANCHOR = "2026-10-28";

function account(overrides) {
  return {
    bankName: "Sparkasse Musterstadt",
    kontoNumber: "1001",
    startDatum: dayjs("2025-01-15"),
    endDatum: dayjs("2026-12-31"),
    zinssatz: 3.25,
    nominal: 25000,
    dayCountConvention: "actual",
    ...overrides,
  };
}

const accounts = [
  account({}),
  account({ kontoNumber: "1002", startDatum: dayjs("2025-04-01"), endDatum: dayjs("2028-03-31"), zinssatz: 2.6, nominal: 15000 }),
  account({ bankName: "Volksbank Beispielstadt", kontoNumber: "2001", startDatum: dayjs("2025-07-01"), endDatum: dayjs("2027-06-30"), zinssatz: 3.05, nominal: 40000 }),
  account({ bankName: "Nordbank AG", kontoNumber: "3001", startDatum: dayjs("2026-02-01"), endDatum: dayjs("2029-01-31"), zinssatz: 2.85, nominal: 20000, dayCountConvention: "30/360" }),
  account({ bankName: "Nordbank AG", kontoNumber: "3002", startDatum: dayjs("2026-05-01"), endDatum: dayjs("2031-04-30"), zinssatz: 2.4, nominal: 10000 }),
];

const totalNominal = accounts.reduce((sum, a) => sum + a.nominal, 0);

describe("Prognose wird immer aus den Konten abgeleitet", () => {
  it("summiert den Bestand aus den Konten und blendet abgelaufene Konten aus", () => {
    const state = { ...defaultForecastState(), horizonYears: 5 };
    const rows = forecastYearAggregates(accounts, state, ANCHOR);

    expect(rows).toHaveLength(5);
    expect(rows[0].year).toBe(2026);
    expect(rows[0].nominal).toBe(totalNominal); // 1001 läuft bis 31.12.2026
    expect(rows[0].expiring).toBe(25000); // Ablauf 2026-12-31
    // 2027: 1001 (31.12.2026) und 2001 (30.06.2027) sind zum Jahresende weg
    expect(rows[1].nominal).toBe(45000);
    expect(rows[1].expiring).toBe(40000); // Ablauf 2027-06-30
    // 2028: nur noch Nordbank-Konten (3001 + 3002)
    expect(rows[2].nominal).toBe(30000);
    expect(rows[2].expiring).toBe(15000); // Ablauf 1002 am 31.03.2028
  });

  it("reagiert sofort auf geänderte Kontodaten (kein Cache, keine gespeicherten Zellen)", () => {
    const state = { ...defaultForecastState(), horizonYears: 5 };
    const before = forecastYearAggregates(accounts, state, ANCHOR);

    const raised = accounts.map((a) =>
      a.kontoNumber === "1001" ? { ...a, nominal: 50000, zinssatz: 4.5 } : a,
    );
    const after = forecastYearAggregates(raised, state, ANCHOR);

    expect(after[0].nominal).toBe(totalNominal + 25000);
    expect(after[0].nominal).not.toBe(before[0].nominal);
    expect(after[0].interest).toBeGreaterThan(before[0].interest);
    expect(after[0].ratePp).toBeGreaterThan(before[0].ratePp);
  });

  it("ignoriert berechnete Zellen aus einem alten prognose.json vollständig", () => {
    const legacy = {
      savedAt: "2026-10-26T10:00:00.000Z",
      startDate: "2026-01-01",
      variants: [
        {
          id: "basis",
          label: "Basis",
          sharePp: 100,
          cells: [
            { year: 2026, nominal: 58500000, ratePp: 2.58, interest: 1509300 },
            { year: 2027, nominal: 110000, ratePp: 2.94, interest: 3234 },
          ],
        },
      ],
    };

    const migrated = parseForecastState(legacy);
    expect(migrated.version).toBe(2);
    expect(migrated.variants).toBeUndefined();
    expect(migrated.groups.map((g) => g.label)).toEqual(["Basis"]);
    expect(migrated.groups.map((g) => g.sharePp)).toEqual([100]);

    const fromLegacy = forecastYearAggregates(accounts, migrated, ANCHOR);
    const fromDefault = forecastYearAggregates(accounts, defaultForecastState(), ANCHOR);
    expect(fromLegacy).toEqual(fromDefault);
    expect(fromLegacy[0].nominal).toBe(totalNominal);
    expect(fromLegacy[0].nominal).not.toBe(58500000);
  });

  it("legt Varianten nur prozentual um, ohne eigene Zahlen zu speichern", () => {
    const state = {
      ...defaultForecastState(),
      groups: [
        { id: "a", label: "Basis", sharePp: 60 },
        { id: "b", label: "Alternativ", sharePp: 40 },
      ],
    };
    const aggregates = forecastYearAggregates(accounts, state, ANCHOR);
    const split = forecastSplitRows(aggregates, state, ANCHOR);

    expect(split).toHaveLength(2);
    expect(split[0].nominalByYear[0]).toBeCloseTo(aggregates[0].nominal * 0.6, 2);
    expect(split[1].nominalByYear[0]).toBeCloseTo(aggregates[0].nominal * 0.4, 2);
    expect(split[0].nominalByYear[0] + split[1].nominalByYear[0]).toBeCloseTo(aggregates[0].nominal, 2);
  });
});

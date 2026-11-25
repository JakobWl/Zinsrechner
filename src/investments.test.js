import { describe, it, expect } from "vitest";
import dayjs from "dayjs";
import { investmentSections, investmentRows, investmentDuration, investmentGrandTotal, sheetLayout } from "./components/InvestmentsView";

const today = dayjs("2026-11-17");
const account = (bankName, start, end, kontoNumber) => ({ bankName, kontoNumber, startDatum: dayjs(start), endDatum: dayjs(end), nominal: 100, zinssatz: 2 });
const accounts = [
  account("A", "2025-01-01", "2027-12-31", "spät"),
  account("A", "2025-01-01", "2026-11-17", "heute"),
  account("B", "2026-11-17", "2027-01-01", "neu"),
  account("C", "2025-01-01", "2027-01-01", "frei"),
  account("A", "2025-01-01", "2026-11-16", "abgelaufen"),
  account("A", "2026-11-18", "2027-01-01", "zukünftig"),
];

describe("Übersicht laufender Veranlagungen", () => {
  it("filtert inklusive Stichtag, sortiert nach Ablauf und behandelt Mehrfach- und Nichtzuordnung", () => {
    const sections = investmentSections(accounts, [{ name: "Erste", banks: ["A", "B"] }, { name: "Zweite", banks: ["A"] }], today);
    expect(sections.map((s) => s.name)).toEqual(["Erste", "Zweite", "Nicht zugeordnet"]);
    expect(sections.map((s) => s.accounts.map((a) => a.kontoNumber))).toEqual([
      ["heute", "neu", "spät"], ["heute", "spät"], ["frei"],
    ]);
  });
  it("fasst Anlagen ohne konfigurierte Gruppen als nicht zugeordnet zusammen", () => {
    expect(investmentSections(accounts, [], today).map((s) => s.name)).toEqual(["Nicht zugeordnet"]);
  });
});


describe("Gruppensummen und Laufzeit", () => {
  it("fügt nach jeder Gruppe eine Summe ihrer angezeigten Anlagen ein", () => {
    const sections = investmentSections(accounts, [{ name: "Erste", banks: ["A", "B"] }, { name: "Zweite", banks: ["A"] }], today);
    const rows = investmentRows(sections);
    expect(rows.filter((row) => row.kind === "total").map(({ groupName, total }) => [groupName, total])).toEqual([["Erste", 300], ["Zweite", 200], ["Nicht zugeordnet", 100]]);
    expect(rows.map((row) => row.kind)).toEqual(["account", "account", "account", "total", "account", "account", "total", "account", "total"]);
  });
  it("zählt in der Gesamtsumme mehrfach zugeordnete Anlagen nur einmal", () => {
    const sections = investmentSections(accounts, [{ name: "Erste", banks: ["A", "B"] }, { name: "Zweite", banks: ["A"] }], today);
    expect(investmentGrandTotal(sections)).toEqual({ count: 4, total: 400 });
  });
  it("zeigt volle Monate und sonst die genaue Anzahl Tage", () => {
    expect(investmentDuration(dayjs("2025-12-04"), dayjs("2026-12-04"))).toBe("12 Mo");
    expect(investmentDuration(dayjs("2026-01-01"), dayjs("2026-01-16"))).toBe("15 Tage");
  });
});

describe("A4-Querformat", () => {
  const area = { width: 1063, height: 660 };
  it("stellt Tabellen nebeneinander, wenn sie dadurch größer dargestellt werden", () => {
    const sizes = [300, 300, 300, 300].map((height) => ({ width: 500, height }));
    const layout = sheetLayout(sizes, area, 16);
    expect(layout.columns).toEqual([[0, 1], [2, 3]]);
    expect(layout.scale).toBeLessThanOrEqual(1.25);
    const width = 2 * 500 + 16;
    const height = 2 * 300 + 16;
    expect(width * layout.scale).toBeLessThanOrEqual(area.width + 0.01);
    expect(height * layout.scale).toBeLessThanOrEqual(area.height + 0.01);
  });
  it("bleibt einspaltig, wenn breite Tabellen nebeneinander kleiner würden", () => {
    const layout = sheetLayout([{ width: 1000, height: 200 }, { width: 1000, height: 200 }], area, 16);
    expect(layout.columns).toEqual([[0, 1]]);
  });
  it("verkleinert lange Listen so, dass sie auf die Seite passen", () => {
    const sizes = Array.from({ length: 6 }, () => ({ width: 700, height: 600 }));
    const layout = sheetLayout(sizes, area, 16);
    const rows = Math.max(...layout.columns.map((column) => column.length));
    const height = rows * 600 + (rows - 1) * 16;
    const width = layout.columns.length * 700 + (layout.columns.length - 1) * 16;
    expect(Math.max(height * layout.scale - area.height, width * layout.scale - area.width)).toBeLessThanOrEqual(0.01);
    expect(layout.columns.flat()).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

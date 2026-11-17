import { describe, it, expect } from "vitest";
import dayjs from "dayjs";
import { investmentSections, investmentRows, investmentDuration } from "./components/InvestmentsView";

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
  it("zeigt volle Monate und sonst die genaue Anzahl Tage", () => {
    expect(investmentDuration(dayjs("2025-12-04"), dayjs("2026-12-04"))).toBe("12 Mo");
    expect(investmentDuration(dayjs("2026-01-01"), dayjs("2026-01-16"))).toBe("15 Tage");
  });
});

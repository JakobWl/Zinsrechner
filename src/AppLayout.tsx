import React, { useEffect, useState } from "react";
import dayjs, { Dayjs } from "dayjs";
import isLeapYear from "dayjs/plugin/isLeapYear";

import {
  Button,
  Card,
  DatePicker,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Layout,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  theme,
  Tooltip,
  Typography,
  message,
} from "antd";
import type { MenuProps } from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  BankOutlined,
  DeleteOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  HistoryOutlined,
  MoonOutlined,
  PlusOutlined,
  PrinterOutlined,
  SunOutlined,
  TableOutlined,
} from "@ant-design/icons";
import { RangePickerProps } from "antd/lib/date-picker";
import packageJson from "../package.json";
import logoPng from "/logo.png";
import {
  calculateInterest,
  calculateQuarterlyInterest,
  DayCountConvention,
} from "./utils/interestCalculation";

dayjs.extend(isLeapYear);

interface KontoData {
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

interface HistoryRow {
  datum: string; // DD.MM.YYYY
  bankName: string;
  menge: number;
  prozent: number;
  ereignis: string; // e.g. "Eröffnung" / "Ablauf"
  aenderung: "up" | "down" | "none";
}

/**
 * Build a chronologically sorted list of all events across all banks.
 * For every account we emit two events: "Eröffnung" at startDatum and
 * "Ablauf" at endDatum. The percentage change is computed per bank against
 * the previous event (increase = green/up, decrease = red/down).
 */
function buildHistoryRows(data: KontoData[] | undefined): HistoryRow[] {
  if (!data || data.length === 0) return [];

  const events: {
    datum: Dayjs;
    bankName: string;
    menge: number;
    prozent: number;
    ereignis: string;
  }[] = [];

  data.forEach((entry) => {
    events.push({
      datum: entry.startDatum,
      bankName: entry.bankName,
      menge: entry.nominal,
      prozent: entry.zinssatz,
      ereignis: "Eröffnung",
    });
    events.push({
      datum: entry.endDatum,
      bankName: entry.bankName,
      menge: entry.nominal,
      prozent: entry.zinssatz,
      ereignis: "Ablauf",
    });
  });

  // Sort chronologically; for the same date, sort by bank name for stability.
  events.sort((a, b) => {
    if (!a.datum.isSame(b.datum, "day")) return a.datum.valueOf() - b.datum.valueOf();
    return a.bankName.localeCompare(b.bankName);
  });

  // Track the last known percent per bank to compute up/down change.
  const lastPercentByBank = new Map<string, number>();
  return events.map((e) => {
    const prev = lastPercentByBank.get(e.bankName);
    let aenderung: HistoryRow["aenderung"] = "none";
    if (prev !== undefined) {
      if (e.prozent > prev) aenderung = "up";
      else if (e.prozent < prev) aenderung = "down";
    }
    lastPercentByBank.set(e.bankName, e.prozent);
    return {
      datum: e.datum.format("DD.MM.YYYY"),
      bankName: e.bankName,
      menge: e.menge,
      prozent: e.prozent,
      ereignis: e.ereignis,
      aenderung,
    };
  });
}

export function AppLayout({
  setDarkMode,
  isDarkMode,
}: {
  setDarkMode?: (value: ((prevState: boolean) => boolean) | boolean) => void;
  isDarkMode?: boolean;
}) {
  const {
    token: { colorErrorBgHover },
  } = theme.useToken();
  const [data, setData] = useState<KontoData[] | undefined>(undefined);
  const [quartalsBeginn, setQuartalsBeginn] = useState<Dayjs | null>(null);
  const [quartalsEnde, setQuartalsEnde] = useState<Dayjs | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    // Load data from JSON file on mount using the exposed preload functions
    window.ipcRenderer.invoke("load-data").then((fileData: string) => {
      if (fileData) {
        try {
          const parsedData: KontoData[] = JSON.parse(fileData);
          setData(
            parsedData.map((entry) => ({
              ...entry,
              startDatum: dayjs(entry.startDatum),
              endDatum: dayjs(entry.endDatum),
            }))
          );
        } catch (error) {
          console.error("Error parsing JSON data:", error);
        }
      }
    });
  }, []);

  useEffect(() => {
    if (!data) return;
    window.ipcRenderer.send("save-data", JSON.stringify(data, null, 2));
  }, [data]);

  const handleAddKonto = (values: any) => {
    if (!data) return;
    const [startDatum, endDatum] = values.dateRange;
    const { bankName, kontoNumber, zinssatz, nominal, dayCountConvention } = values;
    const newKonto: KontoData = {
      bankName,
      kontoNumber,
      startDatum,
      endDatum,
      zinssatz: parseFloat(zinssatz),
      nominal: parseFloat(nominal),
      dayCountConvention: dayCountConvention || "actual",
      kommulierteZinsen: 0,
      verbuchteRueckstellung: 0,
      kommulierteSumme: 0,
    };
    setData([...data, newKonto]);
    form.resetFields();
  };

  const handleDeleteKonto = (index: number) => {
    if (!data) return;
    const updatedData = [...data];
    updatedData.splice(index, 1);
    setData(updatedData);
  };

  const calculateTotalInterest = () => {
    if (!data) return 0;
    console.log("calculateTotalInterest called");
    const total = data.reduce((total, entry) => {
      return total + calculateInterest(entry, entry.startDatum, entry.endDatum);
    }, 0);
    return Math.round(total * 100) / 100;
  };

  const calculateSingleInterest = (entry: KontoData) => {
    console.log("calculateSingleInterest called with:", { entry });
    return calculateInterest(entry, entry.startDatum, entry.endDatum);
  };

  const calculateQuarterlyTotalInterest = () => {
    if (!data) return 0;
    if (!quartalsBeginn || !quartalsEnde) return 0;
    console.log("calculateQuarterlyTotalInterest called");

    const total = data.reduce((total, entry) => {
      return total + calculateQuarterlySingleInterest(entry);
    }, 0);
    return Math.round(total * 100) / 100;
  };

  const calculateQuarterlySingleInterest = (entry: KontoData) => {
    if (!quartalsBeginn || !quartalsEnde) return 0;
    console.log("calculateQuarterlySingleInterest called with:", {
      entry,
      quartalsBeginn: quartalsBeginn.format("DD.MM.YYYY"),
      quartalsEnde: quartalsEnde.format("DD.MM.YYYY"),
    });
    return calculateQuarterlyInterest(entry, quartalsBeginn, quartalsEnde);
  };

  const handleQuartalsRangeChange: RangePickerProps["onChange"] = (
    dates: [start: Dayjs | null, end: Dayjs | null] | null
  ) => {
    console.log(
      "handleQuartalsRangeChange called with:",
      dates
        ? [dates[0]?.format("DD.MM.YYYY"), dates[1]?.format("DD.MM.YYYY")]
        : null
    );
    if (dates) {
      setQuartalsBeginn(dates[0]);
      setQuartalsEnde(dates[1]);
    } else {
      setQuartalsBeginn(null);
      setQuartalsEnde(null);
    }
  };

  const calculateAccumulatedInterest = (entry: KontoData) => {
    if (!quartalsEnde) return 0;
    console.log("calculateAccumulatedInterest called with:", {
      entry,
      quartalsEnde: quartalsEnde.format("DD.MM.YYYY"),
    });
    if (quartalsEnde.isBefore(entry.startDatum)) return 0;
    if (quartalsEnde.isAfter(entry.endDatum)) {
      return calculateInterest(entry, entry.startDatum, entry.endDatum);
    }
    return calculateInterest(entry, entry.startDatum, quartalsEnde);
  };

  const handlePrint = () => {
    if (!data || !quartalsBeginn || !quartalsEnde) return;
    // Split data into active and expired accounts
    const activeData = data.filter(
      (entry) =>
        // If both start and end of entry are overlapping with quartalsStart and quartalsEnde
        !(entry.endDatum < quartalsBeginn || entry.startDatum > quartalsEnde)
    );
    const inactiveData = data.filter(
      (entry) =>
        // If both start and end of entry are not overlapping with quartalsStart and quartalsEnde
        entry.endDatum < quartalsBeginn || entry.startDatum > quartalsEnde
    );

    // Build the table content for a given data array
    const buildTableContent = (dataArray: KontoData[]) => {
      const sortedData = [...dataArray].sort((a, b) =>
        a.bankName.localeCompare(b.bankName)
      );
      const groupedByBank = sortedData.reduce(
        (acc, entry) => {
          if (!acc[entry.bankName]) {
            acc[entry.bankName] = [];
          }
          acc[entry.bankName].push(entry);
          return acc;
        },
        {} as Record<string, KontoData[]>
      );

      let tableContent = "";
      Object.entries(groupedByBank).forEach(([bankName, entries]) => {
        // Build rows for each bank group
        const groupRows = entries
          .map((entry) => {
            const months = entry.endDatum.diff(entry.startDatum, "month");
            const singleInterest = calculateSingleInterest(entry);
            const accumulatedInterest = calculateAccumulatedInterest(entry);
            const quarterlyInterest = calculateQuarterlySingleInterest(entry);
            const paid = entry.verbuchteRueckstellung || 0;
            const reserve = accumulatedInterest - paid;
            return `
            <tr>
              <td>${entry.kontoNumber}</td>
              <td>${entry.startDatum.format("DD.MM.YYYY")}</td>
              <td>${entry.endDatum.format("DD.MM.YYYY")}</td>
              <td>${months}</td>
              <td>${entry.zinssatz}</td>
              <td>${entry.dayCountConvention === "30/360" ? "30/360" : "Tagegenau"}</td>
              <td class="align-right">${entry.nominal.toLocaleString("de-DE", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}</td>
              <td class="align-right">${singleInterest.toLocaleString("de-DE", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}</td>
              <td class="align-right">${accumulatedInterest.toLocaleString(
                "de-DE",
                {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }
              )}</td>
              <td class="align-right">${quarterlyInterest.toLocaleString(
                "de-DE",
                {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }
              )}</td>
              <td class="align-right">${paid.toLocaleString("de-DE", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}</td>
              <td class="align-right">${reserve.toLocaleString("de-DE", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}</td>
            </tr>
          `;
          })
          .join("");

        // Calculate group totals
        const groupNominal = entries.reduce(
          (sum, entry) => sum + entry.nominal,
          0
        );
        const groupSingleInterest = entries.reduce(
          (sum, entry) => sum + calculateSingleInterest(entry),
          0
        );
        const groupAccumulated = entries.reduce(
          (sum, entry) => sum + calculateAccumulatedInterest(entry),
          0
        );
        const groupQuarterly = entries.reduce(
          (sum, entry) => sum + calculateQuarterlySingleInterest(entry),
          0
        );
        const groupPaid = entries.reduce(
          (sum, entry) => sum + (entry.verbuchteRueckstellung || 0),
          0
        );
        const groupReserve = groupAccumulated - groupPaid;

        tableContent += `
        <tbody>
          <tr class="group-header">
            <td colspan="12" class="bank-title">${bankName}</td>
          </tr>
          ${groupRows}
          <tr style="font-weight: bold;">
            <td>Summe</td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td class="align-right">${groupNominal.toLocaleString("de-DE", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}</td>
            <td class="align-right">${groupSingleInterest.toLocaleString(
              "de-DE",
              {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }
            )}</td>
            <td class="align-right">${groupAccumulated.toLocaleString("de-DE", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}</td>
            <td class="align-right">${groupQuarterly.toLocaleString("de-DE", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}</td>
            <td class="align-right">${groupPaid.toLocaleString("de-DE", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}</td>
            <td class="align-right">${groupReserve.toLocaleString("de-DE", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}</td>
          </tr>
        </tbody>
      `;
      });
      return tableContent;
    };

    // Build HTML tables for active and expired accounts
    const activeTableContent = buildTableContent(activeData);
    const expiredTableContent = buildTableContent(inactiveData);

    // Calculate overall totals for active accounts
    const activeTotalNominal = activeData.reduce(
      (sum, entry) => sum + entry.nominal,
      0
    );
    const activeTotalSingleInterest = activeData.reduce(
      (sum, entry) => sum + calculateSingleInterest(entry),
      0
    );
    const activeTotalAccumulated = activeData.reduce(
      (sum, entry) => sum + calculateAccumulatedInterest(entry),
      0
    );
    const activeTotalQuarterly = activeData.reduce(
      (sum, entry) => sum + calculateQuarterlySingleInterest(entry),
      0
    );
    const activeTotalPaid = activeData.reduce(
      (sum, entry) => sum + (entry.verbuchteRueckstellung || 0),
      0
    );
    const activeTotalReserve = activeTotalAccumulated - activeTotalPaid;

    // Calculate overall totals for expired accounts
    const expiredTotalNominal = inactiveData.reduce(
      (sum, entry) => sum + entry.nominal,
      0
    );
    const expiredTotalSingleInterest = inactiveData.reduce(
      (sum, entry) => sum + calculateSingleInterest(entry),
      0
    );
    const expiredTotalAccumulated = inactiveData.reduce(
      (sum, entry) => sum + calculateAccumulatedInterest(entry),
      0
    );
    const expiredTotalQuarterly = inactiveData.reduce(
      (sum, entry) => sum + calculateQuarterlySingleInterest(entry),
      0
    );
    const expiredTotalPaid = inactiveData.reduce(
      (sum, entry) => sum + (entry.verbuchteRueckstellung || 0),
      0
    );
    const expiredTotalReserve = expiredTotalAccumulated - expiredTotalPaid;

    // Calculate overall totals for all accounts using the full data set
    const allTotalNominal = data.reduce((sum, entry) => sum + entry.nominal, 0);
    const allTotalSingleInterest = data.reduce(
      (sum, entry) => sum + calculateSingleInterest(entry),
      0
    );
    const allTotalAccumulated = data.reduce(
      (sum, entry) => sum + calculateAccumulatedInterest(entry),
      0
    );
    const allTotalQuarterly = data.reduce(
      (sum, entry) => sum + calculateQuarterlySingleInterest(entry),
      0
    );
    const allTotalPaid = data.reduce(
      (sum, entry) => sum + (entry.verbuchteRueckstellung || 0),
      0
    );
    const allTotalReserve = allTotalAccumulated - allTotalPaid;

    const activeTableHTML = `
    <table>
      <thead>
        <tr>
          <th>Konto Nummer</th>
          <th>Startdatum</th>
          <th>Enddatum</th>
          <th>Lfz. Mon.</th>
          <th>Zinssatz (%)</th>
          <th>Zinsmethode</th>
          <th>Nominal (€)</th>
          <th>Zinsen gesamte Laufzeit (€)</th>
          <th>Kommulierte Zinsen bis Stichtag (€)</th>
          <th>Zu buchende Quartalszinsen (€)</th>
          <th>Bezahlte Zinsen (€)</th>
          <th>Zinsabgrenzung (KTO 2301) (€)</th>
        </tr>
      </thead>
      ${activeTableContent}
    </table>
  `;

    const expiredTableHTML = `
    <table>
      <thead>
        <tr>
          <th>Konto Nummer</th>
          <th>Startdatum</th>
          <th>Enddatum</th>
          <th>Lfz. Mon.</th>
          <th>Zinssatz (%)</th>
          <th>Zinsmethode</th>
          <th>Nominal (€)</th>
          <th>Zinsen gesamte Laufzeit (€)</th>
          <th>Kommulierte Zinsen bis Stichtag (€)</th>
          <th>Zu buchende Quartalszinsen (€)</th>
          <th>Bezahlte Zinsen (€)</th>
          <th>Zinsabgrenzung (KTO 2301) (€)</th>
        </tr>
      </thead>
      ${expiredTableContent}
    </table>
  `;

    // Build the final HTML content with three summary sections:
    // one for active, one for expired, and one overall summary for all accounts.
    const contentHTML = `
      <html lang="de">
        <head>
          <title>Konten Übersicht</title>
          <style>
            body, html {
              font-family: Arial, sans-serif;
              margin: 0;
              padding: 0;
              color: #333;
            }
            h1, h2 {
              text-align: center;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 20px;
              zoom: 0.7;
            }
            table, th, td {
              border: 1px solid #ddd;
            }
            th {
              background-color: #f2f2f2;
              padding: 12px;
              text-align: left;
            }
            td {
              padding: 12px;
            }
            .align-right {
              text-align: right;
            }
            tr:nth-child(even) {
              background-color: #f9f9f9;
            }
            tr:hover {
              background-color: #f1f1f1;
            }
            .bank-title {
              font-size: 1.5em;
              padding: 12px;
              background-color: #e0e0e0;
            }
            .summary {
              font-size: 1.2em;
              font-weight: bold;
              margin-top: 20px;
            }
            .summary table {
              border-collapse: collapse;
              margin: auto;
            }
            .summary td {
              padding: 5px 20px;
            }
            /* Print-specific styles */
            @media print {
              .page-break {
                page-break-before: always;
              }
            }
          </style>
        </head>
        <body>
          <h1>Konten Übersicht</h1>
          ${
            quartalsBeginn && quartalsEnde
              ? `<p>Quartalsbeginn: ${quartalsBeginn.format(
                  "DD.MM.YYYY"
                )}, Quartalsende: ${quartalsEnde.format("DD.MM.YYYY")}</p>`
              : ""
          }
          <h2>Aktive Konten</h2>
          ${activeTableHTML}
          <div class="summary">
            <h2>Aktive Konten Zusammenfassung</h2>
            <table>
              <tr>
                <td>Gesamtsumme der Nominalwerte:</td>
                <td class="align-right">${activeTotalNominal.toLocaleString(
                  "de-DE",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }
                )} €</td>
              </tr>
              <tr>
                <td>Gesamtsumme der Zinsen gesamte Laufzeit:</td>
                <td class="align-right">${activeTotalSingleInterest.toLocaleString(
                  "de-DE",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }
                )} €</td>
              </tr>
              <tr>
                <td>Gesamtsumme der kummulierten Zinsen bis Stichtag:</td>
                <td class="align-right">${activeTotalAccumulated.toLocaleString(
                  "de-DE",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }
                )} €</td>
              </tr>
              <tr>
                <td>Gesamtsumme der Quartalszinsen:</td>
                <td class="align-right">${activeTotalQuarterly.toLocaleString(
                  "de-DE",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }
                )} €</td>
              </tr>
              <tr>
                <td>Gesamtsumme der Bezahlten Zinsen:</td>
                <td class="align-right">${activeTotalPaid.toLocaleString(
                  "de-DE",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }
                )} €</td>
              </tr>
              <tr>
                <td>Gesamtsumme der Zinsabgrenzungen:</td>
                <td class="align-right">${activeTotalReserve.toLocaleString(
                  "de-DE",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }
                )} €</td>
              </tr>
            </table>
          </div>
      
          <!-- Force new page for Inaktive Konten -->
          <div class="page-break"></div>
          <h2>Inaktive Konten</h2>
          ${expiredTableHTML}
          <div class="summary">
            <h2>Inaktive Konten Zusammenfassung</h2>
            <table>
              <tr>
                <td>Gesamtsumme der Nominalwerte:</td>
                <td class="align-right">${expiredTotalNominal.toLocaleString(
                  "de-DE",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }
                )} €</td>
              </tr>
              <tr>
                <td>Gesamtsumme der Zinsen gesamte Laufzeit:</td>
                <td class="align-right">${expiredTotalSingleInterest.toLocaleString(
                  "de-DE",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }
                )} €</td>
              </tr>
              <tr>
                <td>Gesamtsumme der kummulierten Zinsen bis Stichtag:</td>
                <td class="align-right">${expiredTotalAccumulated.toLocaleString(
                  "de-DE",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }
                )} €</td>
              </tr>
              <tr>
                <td>Gesamtsumme der Quartalszinsen:</td>
                <td class="align-right">${expiredTotalQuarterly.toLocaleString(
                  "de-DE",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }
                )} €</td>
              </tr>
              <tr>
                <td>Gesamtsumme der Bezahlten Zinsen:</td>
                <td class="align-right">${expiredTotalPaid.toLocaleString(
                  "de-DE",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }
                )} €</td>
              </tr>
              <tr>
                <td>Gesamtsumme der Zinsabgrenzungen:</td>
                <td class="align-right">${expiredTotalReserve.toLocaleString(
                  "de-DE",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }
                )} €</td>
              </tr>
            </table>
          </div>
      
          <!-- Force new page for Alle Konten Zusammenfassung -->
          <div class="page-break"></div>
          <div class="summary">
            <h2>Alle Konten Zusammenfassung</h2>
            <table>
              <tr>
                <td>Gesamtsumme der Nominalwerte:</td>
                <td class="align-right">${allTotalNominal.toLocaleString(
                  "de-DE",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }
                )} €</td>
              </tr>
              <tr>
                <td>Gesamtsumme der Zinsen gesamte Laufzeit:</td>
                <td class="align-right">${allTotalSingleInterest.toLocaleString(
                  "de-DE",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }
                )} €</td>
              </tr>
              <tr>
                <td>Gesamtsumme der kummulierten Zinsen bis Stichtag:</td>
                <td class="align-right">${allTotalAccumulated.toLocaleString(
                  "de-DE",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }
                )} €</td>
              </tr>
              <tr>
                <td>Gesamtsumme der Quartalszinsen:</td>
                <td class="align-right">${allTotalQuarterly.toLocaleString(
                  "de-DE",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }
                )} €</td>
              </tr>
              <tr>
                <td>Gesamtsumme der Bezahlten Zinsen:</td>
                <td class="align-right">${allTotalPaid.toLocaleString("de-DE", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })} €</td>
              </tr>
              <tr>
                <td>Gesamtsumme der Zinsabgrenzungen:</td>
                <td class="align-right">${allTotalReserve.toLocaleString(
                  "de-DE",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }
                )} €</td>
              </tr>
            </table>
          </div>
        </body>
      </html>
      `;
    window.ipcRenderer.send("create-print-window", { content: contentHTML });
  };

  const [historyPreviewOpen, setHistoryPreviewOpen] = useState(false);

  const handleExportHistoryPdf = async () => {
    const rows = buildHistoryRows(data);
    if (rows.length === 0) {
      message.warning("Keine Daten zum Exportieren vorhanden.");
      return;
    }
    const result = await window.ipcRenderer.invoke(
      "export-history-pdf",
      rows,
    );
    if (result?.saved) {
      message.success(`Historie als PDF gespeichert: ${result.path}`);
    }
  };

  const handleExportHistoryExcel = async () => {
    const rows = buildHistoryRows(data);
    if (rows.length === 0) {
      message.warning("Keine Daten zum Exportieren vorhanden.");
      return;
    }
    const result = await window.ipcRenderer.invoke(
      "export-history-excel",
      rows,
    );
    if (result?.saved) {
      message.success(`Historie als Excel gespeichert: ${result.path}`);
    }
  };

  const historyMenuItems: MenuProps["items"] = [
    {
      key: "preview",
      icon: <HistoryOutlined />,
      label: "Vorschau anzeigen",
      onClick: () => setHistoryPreviewOpen(true),
      disabled: !data || data.length === 0,
    },
    { type: "divider" },
    {
      key: "pdf",
      icon: <FilePdfOutlined />,
      label: "Als PDF exportieren",
      onClick: handleExportHistoryPdf,
      disabled: !data || data.length === 0,
    },
    {
      key: "excel",
      icon: <FileExcelOutlined />,
      label: "Als Excel exportieren",
      onClick: handleExportHistoryExcel,
      disabled: !data || data.length === 0,
    },
  ];

  const historyPreviewRows = buildHistoryRows(data);

  return (
    <Layout className="layout">
      <Layout.Header className="app-header">
        <Space align="center" size={10} className="app-header-brand">
          <img
            src={logoPng}
            alt="WiDev Zinsrechner Logo"
            className="app-header-logo-img"
          />
          <div className="app-header-titles">
            <Typography.Title level={4} className="app-header-title">
              Zinsrechner
            </Typography.Title>
            <Typography.Text type="secondary" className="app-header-subtitle">
              Anlagen & Zinsabgrenzung
            </Typography.Text>
          </div>
        </Space>
        <div className="app-header-actions">
          <Dropdown menu={{ items: historyMenuItems }} placement="bottomRight">
            <Tooltip title="Chronologische Historie aller Banken">
              <Button
                type="text"
                aria-label="Chronologische Historie aller Banken öffnen"
                icon={<HistoryOutlined />}
              >
                Historie
              </Button>
            </Tooltip>
          </Dropdown>
          <Tooltip title="Theme wechseln">
            <Button
              type="text"
              aria-label={isDarkMode ? "Helles Theme aktivieren" : "Dunkles Theme aktivieren"}
              icon={isDarkMode ? <SunOutlined /> : <MoonOutlined />}
              onClick={() => setDarkMode?.((prev) => !prev)}
            />
          </Tooltip>
        </div>
      </Layout.Header>

      <Layout className="app-body">
        <Layout.Sider
          className="app-sider"
          theme={isDarkMode ? "dark" : "light"}
          width={360}
          breakpoint="lg"
          collapsedWidth={0}
        >
          <div style={{ padding: 16 }}>
            <Card
              className="form-card"
              title={
                <Space>
                  <BankOutlined style={{ color: "var(--ant-color-primary, #1668dc)" }} />
                  <span>Neue Anlage / Konto</span>
                </Space>
              }
            >
              <Form form={form} layout="vertical" onFinish={handleAddKonto} requiredMark>
            <Form.Item
              label="Bank Name"
              name="bankName"
              rules={[
                {
                  required: true,
                  message: "Bitte geben Sie den Banknamen ein!",
                },
              ]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              label="Konto Nummer"
              name="kontoNumber"
              rules={[
                {
                  required: true,
                  message: "Bitte geben Sie die Kontonummer ein!",
                },
              ]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              label="Zeitraum (Startdatum & Enddatum)"
              name="dateRange"
              rules={[
                {
                  required: true,
                  message: "Bitte wählen Sie den Zeitraum aus!",
                },
              ]}
            >
              <DatePicker.RangePicker format="DD.MM.YYYY" />
            </Form.Item>
            <Form.Item
              label="Zinssatz (%)"
              name="zinssatz"
              rules={[
                {
                  required: true,
                  message: "Bitte geben Sie den Zinssatz ein!",
                },
              ]}
            >
              <InputNumber
                style={{ width: "100%" }}
                min={0}
                step={0.01}
                addonAfter="%"
                decimalSeparator=","
              />
            </Form.Item>
            <Form.Item
              label="Nominal (€)"
              name="nominal"
              rules={[
                {
                  required: true,
                  message: "Bitte geben Sie den Nominalbetrag ein!",
                },
              ]}
            >
              <InputNumber
                style={{ width: "100%" }}
                min={0}
                step={1000}
                addonAfter="€"
                decimalSeparator=","
              />
            </Form.Item>
            <Form.Item
              label="Zinsmethode"
              name="dayCountConvention"
              initialValue="actual"
            >
              <Select>
                <Select.Option value="actual">Tagegenau (365)</Select.Option>
                <Select.Option value="30/360">Kaufmännisch (30/360)</Select.Option>
              </Select>
            </Form.Item>
            <Button type="primary" htmlType="submit" block icon={<PlusOutlined />}>
              Konto hinzufügen
            </Button>
          </Form>
            </Card>
          </div>
        </Layout.Sider>

        <Layout.Content className="app-content">
          <div className="stat-grid">
            <Card className="stat-card">
              <Statistic title="Banken" value={data ? data.length : 0} />
            </Card>
            <Card className="stat-card">
              <Statistic
                title="Gesamtnominal (€)"
                value={data ? data.reduce((sum, e) => sum + e.nominal, 0) : 0}
                precision={2}
              />
            </Card>
            <Card className="stat-card">
              <Statistic
                title="Gesamtzinsen (€)"
                value={calculateTotalInterest()}
                precision={2}
              />
            </Card>
            <Card className="stat-card">
              <Statistic
                title="Quartalszinsen (€)"
                value={calculateQuarterlyTotalInterest()}
                precision={2}
              />
            </Card>
          </div>

          <Card className="control-card">
            <Row align="middle" gutter={16}>
            <Form
              layout="horizontal"
              style={{ display: "flex", alignItems: "center" }}
            >
              <Form.Item style={{ marginBottom: 0 }} label="Quartalszeitraum">
                <DatePicker.RangePicker
                  value={
                    quartalsBeginn && quartalsEnde
                      ? [quartalsBeginn, quartalsEnde]
                      : undefined
                  }
                  onChange={handleQuartalsRangeChange}
                  format="DD.MM.YYYY"
                />
              </Form.Item>
            </Form>
            <Typography.Text style={{ marginLeft: 10 }}>
              Quartalszinsen:{" "}
              {calculateQuarterlyTotalInterest().toLocaleString("de-DE")} €
            </Typography.Text>
          </Row>
        </Card>

        <Card
          className="table-card"
          title={
            <Space>
              <TableOutlined />
              <span>Anlagenübersicht</span>
            </Space>
          }
        >
          <div className="table-toolbar">
            <Button
              type="default"
              icon={<PrinterOutlined />}
              disabled={!data || !quartalsBeginn || !quartalsEnde}
              onClick={handlePrint}
            >
              Tabelle drucken
            </Button>
            <Tooltip title="Eine Zeile wird rot markiert, wenn das Enddatum weniger als einen Monat in der Zukunft liegt. (bald abgelaufen)">
              <span className="legend">
                <span
                  className="legend-swatch"
                  style={{ backgroundColor: colorErrorBgHover }}
                  aria-hidden="true"
                />
                <Typography.Text type="secondary">
                  Bald abgelaufen
                </Typography.Text>
              </span>
            </Tooltip>
          </div>
          <Table
            className="table"
            dataSource={data}
            rowKey={(record, index) =>
              `${record.bankName}-${record.kontoNumber}-${index}`
            }
            pagination={false}
            size="middle"
            bordered
            sticky
            scroll={{ x: "max-content", y: "calc(100vh - 360px)" }}
            rowClassName={(record) => {
              const now = dayjs();
              return record.endDatum.isBefore(now.add(1, "month"))
                ? "row-warning"
                : "";
            }}
            summary={() => (
              <Table.Summary fixed>
                <Table.Summary.Row style={{ fontWeight: "bold" }}>
                  <Table.Summary.Cell index={0}>Summe</Table.Summary.Cell>
                  <Table.Summary.Cell index={1} />
                  <Table.Summary.Cell index={2} />
                  <Table.Summary.Cell index={3} />
                  <Table.Summary.Cell index={4} />
                  <Table.Summary.Cell index={5} />
                  <Table.Summary.Cell index={6}>
                    {data
                      ? data
                          .reduce((sum, entry) => sum + entry.nominal, 0)
                          .toLocaleString("de-DE", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })
                      : "0,00"}
                  </Table.Summary.Cell>
                  <Table.Summary.Cell align="end" index={7}>
                    {data
                      ? data
                          .reduce(
                            (sum, entry) =>
                              sum + calculateSingleInterest(entry),
                            0
                          )
                          .toLocaleString("de-DE", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })
                      : "0,00"}
                  </Table.Summary.Cell>
                  <Table.Summary.Cell align="end" index={8}>
                    {data && quartalsEnde
                      ? data
                          .reduce(
                            (sum, entry) =>
                              sum + calculateAccumulatedInterest(entry),
                            0
                          )
                          .toLocaleString("de-DE", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })
                      : "0,00"}
                  </Table.Summary.Cell>
                  <Table.Summary.Cell align="end" index={9}>
                    {data && quartalsBeginn && quartalsEnde
                      ? data
                          .reduce(
                            (sum, entry) =>
                              sum + calculateQuarterlySingleInterest(entry),
                            0
                          )
                          .toLocaleString("de-DE", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })
                      : "0,00"}
                  </Table.Summary.Cell>
                  <Table.Summary.Cell align="end" index={10}>
                    {data
                      ? data
                          .reduce(
                            (sum, entry) =>
                              sum + (entry.verbuchteRueckstellung || 0),
                            0
                          )
                          .toLocaleString("de-DE", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })
                      : "0,00"}
                  </Table.Summary.Cell>
                  <Table.Summary.Cell align="end" index={11}>
                    {data
                      ? data
                          .reduce(
                            (sum, entry) =>
                              sum +
                              calculateQuarterlySingleInterest(entry) -
                              (entry.verbuchteRueckstellung || 0),
                            0
                          )
                          .toLocaleString("de-DE", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })
                      : "0,00"}
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={12} />
                </Table.Summary.Row>
              </Table.Summary>
            )}
          >
            <Table.Column
              title="Bank Name"
              width={120}
              dataIndex="bankName"
              key="bankName"
              fixed="left"
            />
            <Table.Column
              title="Konto Nummer"
              width={220}
              dataIndex="kontoNumber"
              key="kontoNumber"
            />
            <Table.Column
              width={120}
              title="Startdatum"
              dataIndex="startDatum"
              key="startdatum"
              render={(date: Dayjs) => date.format("DD.MM.YYYY")}
            />
            <Table.Column
              width={120}
              title="Enddatum"
              dataIndex="endDatum"
              key="enddatum"
              render={(date: Dayjs) => date.format("DD.MM.YYYY")}
            />
            <Table.Column
              title="Zinssatz"
              width={120}
              dataIndex="zinssatz"
              key="zinssatz"
              align="right"
              render={(value: number) =>
                value.toLocaleString("de-DE", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }) + " %"
              }
            />
            <Table.Column
              title="Zinsmethode"
              width={140}
              key="dayCountConvention"
              render={(_, record: KontoData, index: number) => (
                <Select
                  value={record.dayCountConvention || "actual"}
                  style={{ width: 120 }}
                  onChange={(value: DayCountConvention) => {
                    if (!data) return;
                    setData((prevData) => {
                      if (!prevData) return prevData;
                      const newData = [...prevData];
                      newData[index] = {
                        ...newData[index],
                        dayCountConvention: value,
                      };
                      return newData;
                    });
                  }}
                >
                  <Select.Option value="actual">Tagegenau</Select.Option>
                  <Select.Option value="30/360">30/360</Select.Option>
                </Select>
              )}
            />
            <Table.Column
              title="Nominal (€)"
              width={120}
              dataIndex="nominal"
              key="nominal"
              render={(nominal: number) =>
                nominal.toLocaleString("de-DE", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })
              }
            />
            <Table.Column
              width={120}
              align="right"
              title="Zinsen gesamte Laufzeit (€)"
              key="zinsen"
              render={(_, record: KontoData) => {
                const interest = calculateSingleInterest(record);
                return interest.toLocaleString("de-DE", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                });
              }}
            />
            <Table.Column
              width={150}
              align="right"
              title="Kommulierte Zinsen bis Stichtag"
              key="kommulierteZinsen"
              render={(_, record: KontoData) => {
                const interest = calculateAccumulatedInterest(record);
                return interest.toLocaleString("de-DE", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                });
              }}
            />
            <Table.Column
              width={150}
              align="right"
              title="Zu buchende Quartalszinsen (€)"
              key="quarterlyZinsen"
              render={(_, record: KontoData) => {
                const quarterlyInterest =
                  calculateQuarterlySingleInterest(record);
                return quarterlyInterest.toLocaleString("de-DE", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                });
              }}
            />
            <Table.Column
              width={160}
              align="right"
              title="Bezahlte Zinsen (€)"
              key="verbuchteRueckstellung"
              render={(_, record: KontoData, index: number) => (
                <InputNumber
                  changeOnWheel
                  value={record.verbuchteRueckstellung}
                  min={0}
                  decimalSeparator=","
                  onChange={(value) => {
                    if (!data) return;
                    setData((prevData) => {
                      if (!prevData) return prevData;
                      const newData = [...prevData];
                      newData[index] = {
                        ...newData[index],
                        verbuchteRueckstellung: value || 0,
                      };
                      return newData;
                    });
                  }}
                />
              )}
            />
            <Table.Column
              width={150}
              align="right"
              title="Zinsabgrenzung (KTO 2301) (€)"
              key="kommulierteSumme"
              render={(_, record: KontoData) => {
                const kommulierte = calculateAccumulatedInterest(record);
                const verbuchte = record.verbuchteRueckstellung || 0;
                const result = kommulierte - verbuchte;
                return result.toLocaleString("de-DE", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                });
              }}
            />
            <Table.Column
              width={80}
              title="Aktionen"
              align="center"
              key="aktionen"
              fixed="right"
              render={(_, __, index: number) => (
                <Popconfirm
                  title="Sind Sie sicher, dass Sie dieses Konto löschen möchten?"
                  onConfirm={() => handleDeleteKonto(index)}
                  okText="Ja"
                  cancelText="Nein"
                >
                  <Button danger icon={<DeleteOutlined />} aria-label="Konto löschen" />
                </Popconfirm>
              )}
            />
          </Table>
        </Card>
        </Layout.Content>
      </Layout>

      

      <Typography.Text className="version-text">
        Version {packageJson.version}
      </Typography.Text>

      <Modal
        title="Chronologische Historie aller Banken"
        open={historyPreviewOpen}
        onCancel={() => setHistoryPreviewOpen(false)}
        footer={[
          <Button
            key="pdf"
            icon={<FilePdfOutlined />}
            onClick={handleExportHistoryPdf}
            disabled={historyPreviewRows.length === 0}
          >
            Als PDF
          </Button>,
          <Button
            key="excel"
            icon={<FileExcelOutlined />}
            onClick={handleExportHistoryExcel}
            disabled={historyPreviewRows.length === 0}
          >
            Als Excel
          </Button>,
          <Button key="close" type="primary" onClick={() => setHistoryPreviewOpen(false)}>
            Schließen
          </Button>,
        ]}
        width={900}
      >
        <Table
          size="small"
          pagination={false}
          scroll={{ y: 400 }}
          dataSource={historyPreviewRows}
          rowKey={(record, index) =>
            `${record.datum}-${record.bankName}-${record.ereignis}-${index}`
          }
          columns={[
            {
              title: "Datum",
              dataIndex: "datum",
              key: "datum",
              width: 110,
            },
            {
              title: "Bankname",
              dataIndex: "bankName",
              key: "bankName",
            },
            {
              title: "Menge (€)",
              dataIndex: "menge",
              key: "menge",
              align: "right",
              render: (menge: number) =>
                menge.toLocaleString("de-DE", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }),
            },
            {
              title: "Prozent",
              dataIndex: "prozent",
              key: "prozent",
              align: "right",
              render: (prozent: number, record: HistoryRow) => {
                const color =
                  record.aenderung === "up"
                    ? "#008000"
                    : record.aenderung === "down"
                      ? "#cc0000"
                      : "inherit";
                const arrow =
                  record.aenderung === "up" ? (
                    <ArrowUpOutlined style={{ marginLeft: 4 }} />
                  ) : record.aenderung === "down" ? (
                    <ArrowDownOutlined style={{ marginLeft: 4 }} />
                  ) : null;
                return (
                  <span style={{ color, fontWeight: "bold" }}>
                    {prozent.toLocaleString("de-DE", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                    %{arrow}
                  </span>
                );
              },
            },
            {
              title: "Ereignis",
              dataIndex: "ereignis",
              key: "ereignis",
            },
          ]}
        />
      </Modal>
    </Layout>
  );
}

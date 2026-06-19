import React, { useEffect, useRef, useState } from "react";
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
  Select,
  Space,
  Statistic,
  Switch,
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
  LaptopOutlined,
  MoonOutlined,
  PlusOutlined,
  PrinterOutlined,
  SunOutlined,
  TableOutlined,
} from "@ant-design/icons";
import { RangePickerProps } from "antd/lib/date-picker";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title as ChartTitle,
  Tooltip as ChartTooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";
import packageJson from "../package.json";
import logoPng from "/logo.png";
import {
  calculateInterest,
  calculateQuarterlyInterest,
  DayCountConvention,
} from "./utils/interestCalculation";

dayjs.extend(isLeapYear);

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ChartTitle,
  ChartTooltip,
  Legend,
  Filler,
);

interface HistoryGroup {
  name: string;
  banks: string[];
}

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

interface KontoFormValues {
  bankName: string;
  kontoNumber: string;
  dateRange: [Dayjs, Dayjs];
  zinssatz: number;
  nominal: number;
  dayCountConvention?: DayCountConvention;
}

interface HistoryRow {
  datum: string; // DD.MM.YYYY
  bankName: string;
  menge: number;
  prozent: number;
  wachstum: number | null; // difference to previous rate at same bank
  ereignis: string; // e.g. "Eröffnung" / "Ablauf"
  aenderung: "up" | "down" | "none";
}

/**
 * Build a chronologically sorted list of all events across all banks.
 * For every account we emit two events: "Eröffnung" at startDatum and
 * "Ablauf" at endDatum. The percentage change (up/down) is shown on
 * "Eröffnung" events and compares the new account's rate against the
 * previous account's rate at the same bank (i.e. from the last "Ablauf"
 * to the new "Eröffnung").
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
    if (!a.datum.isSame(b.datum, "day"))
      return a.datum.valueOf() - b.datum.valueOf();
    return a.bankName.localeCompare(b.bankName);
  });

  // Track the last known percent per bank to compute up/down on new accounts.
  const lastPercentByBank = new Map<string, number>();
  return events.map((e) => {
    let aenderung: HistoryRow["aenderung"] = "none";
    let wachstum: number | null = null;
    if (e.ereignis === "Eröffnung") {
      const prev = lastPercentByBank.get(e.bankName);
      if (prev !== undefined) {
        wachstum = e.prozent - prev;
        if (e.prozent > prev) aenderung = "up";
        else if (e.prozent < prev) aenderung = "down";
      }
    }
    if (e.ereignis === "Ablauf") {
      lastPercentByBank.set(e.bankName, e.prozent);
    }
    return {
      datum: e.datum.format("DD.MM.YYYY"),
      bankName: e.bankName,
      menge: e.menge,
      prozent: e.prozent,
      wachstum,
      ereignis: e.ereignis,
      aenderung,
    };
  });
}

export function AppLayout({
  onThemeModeChange,
  themeMode,
  isDarkMode,
}: {
  onThemeModeChange?: (mode: "system" | "light" | "dark") => void;
  themeMode?: "system" | "light" | "dark";
  isDarkMode?: boolean;
}) {
  const {
    token: { colorErrorBgHover },
  } = theme.useToken();
  const [data, setData] = useState<KontoData[]>([]);
  const [quartalsBeginn, setQuartalsBeginn] = useState<Dayjs | null>(null);
  const [quartalsEnde, setQuartalsEnde] = useState<Dayjs | null>(null);
  const hasLoadedData = useRef(false);
  const hasLoadedGroups = useRef(false);
  const [tableScrollY, setTableScrollY] = useState(300);
  const tableRegionRef = useRef<HTMLDivElement>(null);
  const [isNarrow, setIsNarrow] = useState(() => window.innerWidth <= 1080);
  const [historyGroups, setHistoryGroups] = useState<HistoryGroup[]>([]);
  const [groupConfigOpen, setGroupConfigOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth <= 1080);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [form] = Form.useForm<KontoFormValues>();

  useEffect(() => {
    let cancelled = false;

    if (!window.ipcRenderer) {
      hasLoadedData.current = true;
      return;
    }

    window.ipcRenderer
      .invoke("load-data")
      .then((fileData: string) => {
        if (cancelled) return;
        hasLoadedData.current = true;

        if (!fileData) {
          setData([]);
          return;
        }

        try {
          const parsedData: KontoData[] = JSON.parse(fileData);
          setData(
            parsedData.map((entry) => ({
              ...entry,
              startDatum: dayjs(entry.startDatum),
              endDatum: dayjs(entry.endDatum),
            })),
          );
        } catch (error) {
          console.error("Error parsing JSON data:", error);
          message.error(
            "Die gespeicherten Kontodaten konnten nicht geladen werden.",
          );
          setData([]);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        hasLoadedData.current = true;
        console.error("Error loading data:", error);
        message.error("Die Kontodaten konnten nicht geladen werden.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Load history groups
  useEffect(() => {
    if (!window.ipcRenderer) return;
    window.ipcRenderer.invoke("load-history-groups").then((raw: string) => {
      try {
        if (raw) setHistoryGroups(JSON.parse(raw));
      } catch { /* ignore */ }
      hasLoadedGroups.current = true;
    });
  }, []);

  // Save history groups when changed
  useEffect(() => {
    if (!hasLoadedGroups.current || !window.ipcRenderer) return;
    window.ipcRenderer.send("save-history-groups", JSON.stringify(historyGroups, null, 2));
  }, [historyGroups]);

  useEffect(() => {
    if (!hasLoadedData.current || !window.ipcRenderer) return;
    window.ipcRenderer.send("save-data", JSON.stringify(data, null, 2));
  }, [data]);

  useEffect(() => {
    const compute = () => {
      const el = tableRegionRef.current;
      if (!el) return;
      // In responsive (stacked) layout, don't constrain table height
      if (window.innerWidth <= 1080) {
        setTableScrollY(500);
        return;
      }
      const top = el.getBoundingClientRect().top;
      // viewport minus top offset, minus card padding (24), toolbar (~44), thead (~40), summary row (~46)
      const y = window.innerHeight - top - 154;
      setTableScrollY(Math.max(150, y));
    };
    compute();
    window.addEventListener("resize", compute);
    const ro = new ResizeObserver(compute);
    if (tableRegionRef.current) ro.observe(tableRegionRef.current);
    return () => {
      window.removeEventListener("resize", compute);
      ro.disconnect();
    };
  }, []);

  const handleAddKonto = (values: KontoFormValues) => {
    const [startDatum, endDatum] = values.dateRange;
    const { bankName, kontoNumber, zinssatz, nominal, dayCountConvention } =
      values;
    const newKonto: KontoData = {
      bankName: bankName.trim(),
      kontoNumber: kontoNumber.trim(),
      startDatum,
      endDatum,
      zinssatz: Number(zinssatz),
      nominal: Number(nominal),
      dayCountConvention: dayCountConvention || "actual",
      kommulierteZinsen: 0,
      verbuchteRueckstellung: 0,
      kommulierteSumme: 0,
    };
    setData((currentData) => [...currentData, newKonto]);
    form.resetFields();
    message.success("Konto wurde hinzugefügt.");
  };

  const handleDeleteKonto = (index: number) => {
    setData((currentData) =>
      currentData.filter((_, itemIndex) => itemIndex !== index),
    );
  };

  const calculateTotalInterest = () => {
    const total = data.reduce((total, entry) => {
      return total + calculateInterest(entry, entry.startDatum, entry.endDatum);
    }, 0);
    return Math.round(total * 100) / 100;
  };

  const calculateSingleInterest = (entry: KontoData) => {
    return calculateInterest(entry, entry.startDatum, entry.endDatum);
  };

  const calculateQuarterlyTotalInterest = () => {
    if (!quartalsBeginn || !quartalsEnde) return 0;

    const total = data.reduce((total, entry) => {
      return total + calculateQuarterlySingleInterest(entry);
    }, 0);
    return Math.round(total * 100) / 100;
  };

  const calculateQuarterlySingleInterest = (entry: KontoData) => {
    if (!quartalsBeginn || !quartalsEnde) return 0;
    return calculateQuarterlyInterest(entry, quartalsBeginn, quartalsEnde);
  };

  const handleQuartalsRangeChange: RangePickerProps["onChange"] = (
    dates: [start: Dayjs | null, end: Dayjs | null] | null,
  ) => {
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
    if (quartalsEnde.isBefore(entry.startDatum)) return 0;
    if (quartalsEnde.isAfter(entry.endDatum)) {
      return calculateInterest(entry, entry.startDatum, entry.endDatum);
    }
    return calculateInterest(entry, entry.startDatum, quartalsEnde);
  };

  const handlePrint = () => {
    if (data.length === 0 || !quartalsBeginn || !quartalsEnde) return;
    const activeData = data.filter(
      (entry) =>
        !entry.endDatum.isBefore(quartalsBeginn, "day") &&
        !entry.startDatum.isAfter(quartalsEnde, "day"),
    );
    const inactiveData = data.filter(
      (entry) =>
        entry.endDatum.isBefore(quartalsBeginn, "day") ||
        entry.startDatum.isAfter(quartalsEnde, "day"),
    );

    // Build the table content for a given data array
    const buildTableContent = (dataArray: KontoData[]) => {
      const sortedData = [...dataArray].sort((a, b) =>
        a.bankName.localeCompare(b.bankName),
      );
      const groupedByBank = sortedData.reduce(
        (acc, entry) => {
          if (!acc[entry.bankName]) {
            acc[entry.bankName] = [];
          }
          acc[entry.bankName].push(entry);
          return acc;
        },
        {} as Record<string, KontoData[]>,
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
                },
              )}</td>
              <td class="align-right">${quarterlyInterest.toLocaleString(
                "de-DE",
                {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                },
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
          0,
        );
        const groupSingleInterest = entries.reduce(
          (sum, entry) => sum + calculateSingleInterest(entry),
          0,
        );
        const groupAccumulated = entries.reduce(
          (sum, entry) => sum + calculateAccumulatedInterest(entry),
          0,
        );
        const groupQuarterly = entries.reduce(
          (sum, entry) => sum + calculateQuarterlySingleInterest(entry),
          0,
        );
        const groupPaid = entries.reduce(
          (sum, entry) => sum + (entry.verbuchteRueckstellung || 0),
          0,
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
              },
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
      0,
    );
    const activeTotalSingleInterest = activeData.reduce(
      (sum, entry) => sum + calculateSingleInterest(entry),
      0,
    );
    const activeTotalAccumulated = activeData.reduce(
      (sum, entry) => sum + calculateAccumulatedInterest(entry),
      0,
    );
    const activeTotalQuarterly = activeData.reduce(
      (sum, entry) => sum + calculateQuarterlySingleInterest(entry),
      0,
    );
    const activeTotalPaid = activeData.reduce(
      (sum, entry) => sum + (entry.verbuchteRueckstellung || 0),
      0,
    );
    const activeTotalReserve = activeTotalAccumulated - activeTotalPaid;

    // Calculate overall totals for expired accounts
    const expiredTotalNominal = inactiveData.reduce(
      (sum, entry) => sum + entry.nominal,
      0,
    );
    const expiredTotalSingleInterest = inactiveData.reduce(
      (sum, entry) => sum + calculateSingleInterest(entry),
      0,
    );
    const expiredTotalAccumulated = inactiveData.reduce(
      (sum, entry) => sum + calculateAccumulatedInterest(entry),
      0,
    );
    const expiredTotalQuarterly = inactiveData.reduce(
      (sum, entry) => sum + calculateQuarterlySingleInterest(entry),
      0,
    );
    const expiredTotalPaid = inactiveData.reduce(
      (sum, entry) => sum + (entry.verbuchteRueckstellung || 0),
      0,
    );
    const expiredTotalReserve = expiredTotalAccumulated - expiredTotalPaid;

    // Calculate overall totals for all accounts using the full data set
    const allTotalNominal = data.reduce((sum, entry) => sum + entry.nominal, 0);
    const allTotalSingleInterest = data.reduce(
      (sum, entry) => sum + calculateSingleInterest(entry),
      0,
    );
    const allTotalAccumulated = data.reduce(
      (sum, entry) => sum + calculateAccumulatedInterest(entry),
      0,
    );
    const allTotalQuarterly = data.reduce(
      (sum, entry) => sum + calculateQuarterlySingleInterest(entry),
      0,
    );
    const allTotalPaid = data.reduce(
      (sum, entry) => sum + (entry.verbuchteRueckstellung || 0),
      0,
    );
    const allTotalReserve = allTotalAccumulated - allTotalPaid;

    const activeTableHTML = `
    <table>
      <thead>
        <tr>
          <th>Kontonummer</th>
          <th>Startdatum</th>
          <th>Enddatum</th>
          <th>Lfz. Mon.</th>
          <th>Zinssatz (%)</th>
          <th>Zinsmethode</th>
          <th>Nominal (€)</th>
          <th>Zinsen gesamte Laufzeit (€)</th>
          <th>Kumulierte Zinsen bis Stichtag (€)</th>
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
          <th>Kontonummer</th>
          <th>Startdatum</th>
          <th>Enddatum</th>
          <th>Lfz. Mon.</th>
          <th>Zinssatz (%)</th>
          <th>Zinsmethode</th>
          <th>Nominal (€)</th>
          <th>Zinsen gesamte Laufzeit (€)</th>
          <th>Kumulierte Zinsen bis Stichtag (€)</th>
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
                  "DD.MM.YYYY",
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
                  },
                )} €</td>
              </tr>
              <tr>
                <td>Gesamtsumme der Zinsen gesamte Laufzeit:</td>
                <td class="align-right">${activeTotalSingleInterest.toLocaleString(
                  "de-DE",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  },
                )} €</td>
              </tr>
              <tr>
                <td>Gesamtsumme der kumulierten Zinsen bis Stichtag:</td>
                <td class="align-right">${activeTotalAccumulated.toLocaleString(
                  "de-DE",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  },
                )} €</td>
              </tr>
              <tr>
                <td>Gesamtsumme der Quartalszinsen:</td>
                <td class="align-right">${activeTotalQuarterly.toLocaleString(
                  "de-DE",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  },
                )} €</td>
              </tr>
              <tr>
                <td>Gesamtsumme der Bezahlten Zinsen:</td>
                <td class="align-right">${activeTotalPaid.toLocaleString(
                  "de-DE",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  },
                )} €</td>
              </tr>
              <tr>
                <td>Gesamtsumme der Zinsabgrenzungen:</td>
                <td class="align-right">${activeTotalReserve.toLocaleString(
                  "de-DE",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  },
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
                  },
                )} €</td>
              </tr>
              <tr>
                <td>Gesamtsumme der Zinsen gesamte Laufzeit:</td>
                <td class="align-right">${expiredTotalSingleInterest.toLocaleString(
                  "de-DE",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  },
                )} €</td>
              </tr>
              <tr>
                <td>Gesamtsumme der kumulierten Zinsen bis Stichtag:</td>
                <td class="align-right">${expiredTotalAccumulated.toLocaleString(
                  "de-DE",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  },
                )} €</td>
              </tr>
              <tr>
                <td>Gesamtsumme der Quartalszinsen:</td>
                <td class="align-right">${expiredTotalQuarterly.toLocaleString(
                  "de-DE",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  },
                )} €</td>
              </tr>
              <tr>
                <td>Gesamtsumme der Bezahlten Zinsen:</td>
                <td class="align-right">${expiredTotalPaid.toLocaleString(
                  "de-DE",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  },
                )} €</td>
              </tr>
              <tr>
                <td>Gesamtsumme der Zinsabgrenzungen:</td>
                <td class="align-right">${expiredTotalReserve.toLocaleString(
                  "de-DE",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  },
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
                  },
                )} €</td>
              </tr>
              <tr>
                <td>Gesamtsumme der Zinsen gesamte Laufzeit:</td>
                <td class="align-right">${allTotalSingleInterest.toLocaleString(
                  "de-DE",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  },
                )} €</td>
              </tr>
              <tr>
                <td>Gesamtsumme der kumulierten Zinsen bis Stichtag:</td>
                <td class="align-right">${allTotalAccumulated.toLocaleString(
                  "de-DE",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  },
                )} €</td>
              </tr>
              <tr>
                <td>Gesamtsumme der Quartalszinsen:</td>
                <td class="align-right">${allTotalQuarterly.toLocaleString(
                  "de-DE",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  },
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
                  },
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
  const [historyShowChart, setHistoryShowChart] = useState(false);

  const handleExportHistoryPdf = async () => {
    const rows = buildHistoryRows(data);
    if (rows.length === 0) {
      message.warning("Keine Daten zum Exportieren vorhanden.");
      return;
    }
    const result = await window.ipcRenderer.invoke("export-history-pdf", rows, historyGroups);
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
      historyGroups,
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
      disabled: data.length === 0,
    },
    { type: "divider" },
    {
      key: "pdf",
      icon: <FilePdfOutlined />,
      label: "Als PDF exportieren",
      onClick: handleExportHistoryPdf,
      disabled: data.length === 0,
    },
    {
      key: "excel",
      icon: <FileExcelOutlined />,
      label: "Als Excel exportieren",
      onClick: handleExportHistoryExcel,
      disabled: data.length === 0,
    },
    { type: "divider" },
    {
      key: "groups",
      icon: <TableOutlined />,
      label: "Gruppen konfigurieren",
      onClick: () => setGroupConfigOpen(true),
    },
  ];

  const historyPreviewRows = buildHistoryRows(data);

  return (
    <Layout className="layout" data-theme={isDarkMode ? "dark" : "light"}>
      <a href="#main-content" className="skip-link">
        Zum Inhalt springen
      </a>
      <Layout.Header className="app-header" role="banner">
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
              Anlagen & Zinsabgrenzung · Version {packageJson.version}
            </Typography.Text>
          </div>
        </Space>
        <div className="app-header-actions">
          <Dropdown menu={{ items: historyMenuItems }} placement="bottomRight">
            <Button
              type="text"
              aria-label="Chronologische Historie aller Banken öffnen"
              icon={<HistoryOutlined />}
            >
              Historie
            </Button>
          </Dropdown>
          <Space.Compact size="small">
              <Tooltip title="Hell">
                <Button
                  type={themeMode === "light" ? "primary" : "text"}
                  icon={<SunOutlined />}
                  onClick={() => onThemeModeChange?.("light")}
                  aria-label="Helles Theme"
                />
              </Tooltip>
              <Tooltip title="System">
                <Button
                  type={themeMode === "system" ? "primary" : "text"}
                  icon={<LaptopOutlined />}
                  onClick={() => onThemeModeChange?.("system")}
                  aria-label="System Theme"
                />
              </Tooltip>
              <Tooltip title="Dunkel">
                <Button
                  type={themeMode === "dark" ? "primary" : "text"}
                  icon={<MoonOutlined />}
                  onClick={() => onThemeModeChange?.("dark")}
                  aria-label="Dunkles Theme"
                />
              </Tooltip>
            </Space.Compact>
        </div>
      </Layout.Header>

      <Layout className={`app-body${isNarrow ? ' app-body-narrow' : ''}`}>
        {isNarrow ? (
          <div className="app-sider" role="complementary" aria-label="Konto erfassen">
            <div className="app-sider-inner">
            <Card
              className="form-card"
              title={
                <Space>
                  <BankOutlined
                    style={{ color: "var(--ant-color-primary, #1668dc)" }}
                  />
                  <span>Neue Anlage erfassen</span>
                </Space>
              }
            >
              <Form
                form={form}
                layout="vertical"
                onFinish={handleAddKonto}
                requiredMark
              >
                <Form.Item
                  label="Bankname"
                  name="bankName"
                  rules={[
                    {
                      required: true,
                      message: "Bitte geben Sie den Banknamen ein.",
                    },
                  ]}
                >
                  <Input
                    autoComplete="organization"
                    placeholder="z. B. Erste Bank"
                    aria-label="Bankname"
                  />
                </Form.Item>
                <Form.Item
                  label="Kontonummer"
                  name="kontoNumber"
                  rules={[
                    {
                      required: true,
                      message: "Bitte geben Sie die Kontonummer ein.",
                    },
                  ]}
                >
                  <Input
                    autoComplete="off"
                    placeholder="z. B. 123456789"
                    aria-label="Kontonummer"
                  />
                </Form.Item>
                <Form.Item
                  label="Zeitraum (Startdatum & Enddatum)"
                  name="dateRange"
                  rules={[
                    {
                      required: true,
                      message: "Bitte wählen Sie den Zeitraum aus.",
                    },
                  ]}
                >
                  <DatePicker.RangePicker
                    format="DD.MM.YYYY"
                    style={{ width: "100%" }}
                  />
                </Form.Item>
                <Form.Item
                  label="Zinssatz (%)"
                  name="zinssatz"
                  rules={[
                    {
                      required: true,
                      message: "Bitte geben Sie den Zinssatz ein.",
                    },
                  ]}
                >
                  <InputNumber
                    style={{ width: "100%" }}
                    min={0}
                    step={0.01}
                    aria-label="Zinssatz in Prozent"
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
                      message: "Bitte geben Sie den Nominalbetrag ein.",
                    },
                  ]}
                >
                  <InputNumber
                    style={{ width: "100%" }}
                    min={0}
                    step={1000}
                    aria-label="Nominalbetrag in Euro"
                    addonAfter="€"
                    decimalSeparator=","
                  />
                </Form.Item>
                <Form.Item
                  label="Zinsmethode"
                  name="dayCountConvention"
                  initialValue="actual"
                >
                  <Select aria-label="Zinsmethode">
                    <Select.Option value="actual">
                      Tagegenau (365)
                    </Select.Option>
                    <Select.Option value="30/360">
                      Kaufmännisch (30/360)
                    </Select.Option>
                  </Select>
                </Form.Item>
                <Button
                  type="primary"
                  htmlType="submit"
                  block
                  icon={<PlusOutlined />}
                >
                  Konto hinzufügen
                </Button>
              </Form>
            </Card>
          </div>
          </div>
        ) : (
        <Layout.Sider
          className="app-sider"
          theme={isDarkMode ? "dark" : "light"}
          width={360}
          role="complementary"
          aria-label="Konto erfassen"
        >
          <div className="app-sider-inner">
            <Card
              className="form-card"
              title={
                <Space>
                  <BankOutlined
                    style={{ color: "var(--ant-color-primary, #1668dc)" }}
                  />
                  <span>Neue Anlage erfassen</span>
                </Space>
              }
            >
              <Form
                form={form}
                layout="vertical"
                onFinish={handleAddKonto}
                requiredMark
              >
                <Form.Item
                  label="Bankname"
                  name="bankName"
                  rules={[
                    {
                      required: true,
                      message: "Bitte geben Sie den Banknamen ein.",
                    },
                  ]}
                >
                  <Input
                    autoComplete="organization"
                    placeholder="z. B. Erste Bank"
                    aria-label="Bankname"
                  />
                </Form.Item>
                <Form.Item
                  label="Kontonummer"
                  name="kontoNumber"
                  rules={[
                    {
                      required: true,
                      message: "Bitte geben Sie die Kontonummer ein.",
                    },
                  ]}
                >
                  <Input
                    autoComplete="off"
                    placeholder="z. B. 123456789"
                    aria-label="Kontonummer"
                  />
                </Form.Item>
                <Form.Item
                  label="Zeitraum (Startdatum & Enddatum)"
                  name="dateRange"
                  rules={[
                    {
                      required: true,
                      message: "Bitte wählen Sie den Zeitraum aus.",
                    },
                  ]}
                >
                  <DatePicker.RangePicker
                    format="DD.MM.YYYY"
                    style={{ width: "100%" }}
                  />
                </Form.Item>
                <Form.Item
                  label="Zinssatz (%)"
                  name="zinssatz"
                  rules={[
                    {
                      required: true,
                      message: "Bitte geben Sie den Zinssatz ein.",
                    },
                  ]}
                >
                  <InputNumber
                    style={{ width: "100%" }}
                    min={0}
                    step={0.01}
                    aria-label="Zinssatz in Prozent"
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
                      message: "Bitte geben Sie den Nominalbetrag ein.",
                    },
                  ]}
                >
                  <InputNumber
                    style={{ width: "100%" }}
                    min={0}
                    step={1000}
                    aria-label="Nominalbetrag in Euro"
                    addonAfter="€"
                    decimalSeparator=","
                  />
                </Form.Item>
                <Form.Item
                  label="Zinsmethode"
                  name="dayCountConvention"
                  initialValue="actual"
                >
                  <Select aria-label="Zinsmethode">
                    <Select.Option value="actual">
                      Tagegenau (365)
                    </Select.Option>
                    <Select.Option value="30/360">
                      Kaufmännisch (30/360)
                    </Select.Option>
                  </Select>
                </Form.Item>
                <Button
                  type="primary"
                  htmlType="submit"
                  block
                  icon={<PlusOutlined />}
                >
                  Konto hinzufügen
                </Button>
              </Form>
            </Card>
          </div>
        </Layout.Sider>
        )}

        <Layout.Content
          id="main-content"
          className="app-content"
          role="main"
          tabIndex={-1}
        >
          <div className="stat-grid">
            <Card className="stat-card" size="small">
              <Statistic title="Banken" value={data.length} />
            </Card>
            <Card className="stat-card" size="small">
              <Statistic
                title="Gesamtnominal (€)"
                value={data.reduce((sum, e) => sum + e.nominal, 0)}
                precision={2}
              />
            </Card>
            <Card className="stat-card" size="small">
              <Statistic
                title="Gesamtzinsen (€)"
                value={calculateTotalInterest()}
                precision={2}
              />
            </Card>
            <Card className="stat-card" size="small">
              <Statistic
                title="Quartalszinsen (€)"
                value={calculateQuarterlyTotalInterest()}
                precision={2}
              />
            </Card>
          </div>

          <Card className="control-card" size="small" title="Quartalsauswertung">
            <div className="control-panel">
              <Form layout="vertical" className="quarter-form">
                <Form.Item label="Quartalszeitraum" className="quarter-range">
                  <DatePicker.RangePicker
                    value={
                      quartalsBeginn && quartalsEnde
                        ? [quartalsBeginn, quartalsEnde]
                        : undefined
                    }
                    onChange={handleQuartalsRangeChange}
                    format="DD.MM.YYYY"
                    allowClear
                    style={{ width: "100%" }}
                  />
                </Form.Item>
              </Form>
              <Statistic
                title="Quartalszinsen"
                value={calculateQuarterlyTotalInterest()}
                precision={2}
                suffix="€"
              />
            </div>
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
                disabled={data.length === 0 || !quartalsBeginn || !quartalsEnde}
                onClick={handlePrint}
                aria-label="Anlagenübersicht für den gewählten Quartalszeitraum drucken"
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
            <div
              className="table-region"
              ref={tableRegionRef}
              role="region"
              aria-label="Anlagenübersicht"
            >
              <Table
                className="table"
                dataSource={data}
                rowKey={(record, index) =>
                  `${record.bankName}-${record.kontoNumber}-${index}`
                }
                pagination={false}
                size="middle"
                bordered
                scroll={{ x: "max-content", y: tableScrollY }}
                locale={{ emptyText: "Keine Anlagen erfasst" }}
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
                                0,
                              )
                              .toLocaleString("de-DE", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })
                          : "0,00"}
                      </Table.Summary.Cell>
                      <Table.Summary.Cell align="end" index={8}>
                        {quartalsEnde
                          ? data
                              .reduce(
                                (sum, entry) =>
                                  sum + calculateAccumulatedInterest(entry),
                                0,
                              )
                              .toLocaleString("de-DE", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })
                          : "0,00"}
                      </Table.Summary.Cell>
                      <Table.Summary.Cell align="end" index={9}>
                        {quartalsBeginn && quartalsEnde
                          ? data
                              .reduce(
                                (sum, entry) =>
                                  sum + calculateQuarterlySingleInterest(entry),
                                0,
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
                                0,
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
                                0,
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
                  title="Bankname"
                  width={120}
                  dataIndex="bankName"
                  key="bankName"
                  fixed="left"
                />
                <Table.Column
                  title="Kontonummer"
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
                      aria-label={`Zinsmethode für ${record.bankName} ${record.kontoNumber}`}
                      onChange={(value: DayCountConvention) => {
                        setData((prevData) => {
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
                  align="right"
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
                  title="Kumulierte Zinsen bis Stichtag"
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
                      aria-label={`Bezahlte Zinsen für ${record.bankName} ${record.kontoNumber}`}
                      decimalSeparator=","
                      onChange={(value) => {
                        setData((prevData) => {
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
                      <Button
                        danger
                        icon={<DeleteOutlined />}
                        aria-label="Konto löschen"
                      />
                    </Popconfirm>
                  )}
                />
              </Table>
            </div>
          </Card>
        </Layout.Content>
      </Layout>

      <Modal
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span>Chronologische Historie aller Banken</span>
            <Switch
              checked={historyShowChart}
              onChange={setHistoryShowChart}
              checkedChildren="Diagramm"
              unCheckedChildren="Tabelle"
            />
          </div>
        }
        open={historyPreviewOpen}
        onCancel={() => setHistoryPreviewOpen(false)}
        width="60vw"
        styles={{ body: { maxHeight: "80vh", overflow: "auto" } }}
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
        ]}
      >
        {!historyShowChart ? (
        <Table
          size="small"
          bordered
          pagination={false}
          scroll={{ y: "65vh" }}
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
              title: "Veranlagung (€)",
              key: "veranlagung-group",
              children: [
                ...(historyGroups.length > 0
                  ? historyGroups.map((group) => ({
                      title: group.name,
                      key: `veranlagung-${group.name}`,
                      align: "right" as const,
                      width: 160,
                      render: (_: unknown, record: HistoryRow) =>
                        record.ereignis === "Eröffnung" &&
                        group.banks.includes(record.bankName)
                          ? record.menge.toLocaleString("de-DE", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })
                          : "",
                    }))
                  : [
                      {
                        title: "Betrag",
                        key: "veranlagung",
                        align: "right" as const,
                        width: 160,
                        render: (_: unknown, record: HistoryRow) =>
                          record.ereignis === "Eröffnung"
                            ? record.menge.toLocaleString("de-DE", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })
                            : "",
                      },
                    ]),
                {
                  title: "Ablauf",
                  key: "ablauf",
                  align: "right" as const,
                  width: 160,
                  onCell: () => ({ style: { backgroundColor: "rgba(0,0,0,0.04)" } }),
                  render: (_: unknown, record: HistoryRow) =>
                    record.ereignis === "Ablauf"
                      ? record.menge.toLocaleString("de-DE", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })
                      : "",
                },
              ],
            },
          ]}
        />
        ) : historyPreviewRows.length > 0 ? (() => {
          const dates = [...new Set(historyPreviewRows.map((r) => r.datum))];
          const runningTotals: Record<string, number[]> = {};

          // Always compute "Gesamt"
          runningTotals["Gesamt"] = [];
          let totalSum = 0;
          dates.forEach((d) => {
            const rowsForDate = historyPreviewRows.filter((r) => r.datum === d);
            rowsForDate.forEach((r) => {
              if (r.ereignis === "Eröffnung") totalSum += r.menge;
              if (r.ereignis === "Ablauf") totalSum -= r.menge;
            });
            runningTotals["Gesamt"].push(totalSum);
          });

          // Per group
          if (historyGroups.length > 0) {
            historyGroups.forEach((g) => {
              runningTotals[g.name] = [];
              let sum = 0;
              dates.forEach((d) => {
                const rowsForDate = historyPreviewRows.filter((r) => r.datum === d);
                rowsForDate.forEach((r) => {
                  if (g.banks.includes(r.bankName)) {
                    if (r.ereignis === "Eröffnung") sum += r.menge;
                    if (r.ereignis === "Ablauf") sum -= r.menge;
                  }
                });
                runningTotals[g.name].push(sum);
              });
            });
          }

          const colors = [
            "#333333", "#1677ff", "#52c41a", "#faad14", "#f5222d", "#722ed1",
            "#13c2c2", "#eb2f96", "#fa8c16",
          ];

          const lineData = {
            labels: dates,
            datasets: Object.keys(runningTotals).map((name, i) => ({
              label: name,
              data: runningTotals[name],
              borderColor: colors[i % colors.length],
              backgroundColor: colors[i % colors.length] + "33",
              fill: name === "Gesamt",
              tension: 0.3,
              borderWidth: name === "Gesamt" ? 3 : 2,
            })),
          };

          const lineOptions = {
            responsive: true,
            plugins: {
              title: { display: true, text: "Veranlagungsverlauf (kumulativ)" },
              legend: { position: "top" as const },
            },
            scales: {
              y: {
                beginAtZero: true,
                ticks: {
                  callback: (v: unknown) =>
                    Number(v).toLocaleString("de-DE") + " €",
                },
              },
            },
          };

          return (
            <div style={{ height: "65vh", display: "flex", alignItems: "center" }}>
              <Line data={lineData} options={lineOptions} />
            </div>
          );
        })() : null}
      </Modal>

      <Modal
        title="Historie-Gruppen konfigurieren"
        open={groupConfigOpen}
        onCancel={() => setGroupConfigOpen(false)}
        footer={
          <Button type="primary" onClick={() => setGroupConfigOpen(false)}>
            Fertig
          </Button>
        }
        width={600}
      >
        <Typography.Paragraph type="secondary">
          Erstellen Sie Gruppen, um in der Historie separate Spalten pro Gruppe
          anzuzeigen. Jede Gruppe enthält ausgewählte Banken.
        </Typography.Paragraph>
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          {historyGroups.map((group, idx) => (
            <Card
              key={idx}
              size="small"
              title={group.name}
              extra={
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() =>
                    setHistoryGroups((prev) => prev.filter((_, i) => i !== idx))
                  }
                />
              }
            >
              <Select
                mode="multiple"
                style={{ width: "100%" }}
                placeholder="Banken auswählen"
                value={group.banks}
                onChange={(banks) =>
                  setHistoryGroups((prev) =>
                    prev.map((g, i) => (i === idx ? { ...g, banks } : g)),
                  )
                }
                options={[
                  ...new Set(data.map((d) => d.bankName)),
                ].map((b) => ({ label: b, value: b }))}
              />
            </Card>
          ))}
          <Space.Compact style={{ width: "100%" }}>
            <Input
              placeholder="Neuer Gruppenname"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onPressEnter={() => {
                if (newGroupName.trim()) {
                  setHistoryGroups((prev) => [
                    ...prev,
                    { name: newGroupName.trim(), banks: [] },
                  ]);
                  setNewGroupName("");
                }
              }}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                if (newGroupName.trim()) {
                  setHistoryGroups((prev) => [
                    ...prev,
                    { name: newGroupName.trim(), banks: [] },
                  ]);
                  setNewGroupName("");
                }
              }}
            >
              Hinzufügen
            </Button>
          </Space.Compact>
        </Space>
      </Modal>
    </Layout>
  );
}

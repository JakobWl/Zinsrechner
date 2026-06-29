import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  SyncOutlined,
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
  const [historyGroups, setHistoryGroups] = useState<HistoryGroup[]>([]);
  const [groupConfigOpen, setGroupConfigOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{
    store?: boolean;
    status: string;
    version?: string;
    message?: string;
  } | null>(null);

  // Shared, rAF-throttled resize handling. Both the responsive "isNarrow"
  // flag and the table scroll-height computation are derived from the same
  // throttled callback so a window resize no longer fires dozens of
  // synchronous setStates per second (which was the main source of the
  // laggy resize feeling and the slow Diagramm/Tabelle switch, because each
  // intermediate setState re-rendered this entire 2000-line component and
  // recomputed every interest aggregate).
  const rafId = useRef<number | null>(null);
  const scheduleResize = useCallback(() => {
    if (rafId.current != null) return;
    rafId.current = window.requestAnimationFrame(() => {
      rafId.current = null;
      const narrow = window.innerWidth <= 768;

      const el = tableRegionRef.current;
      if (!el) return;
      if (narrow) {
        setTableScrollY((prev) => (prev === 500 ? prev : 500));
        return;
      }
      // Measure the real available height of the table region (the flex
      // item that wraps the Table) instead of guessing a fixed offset.
      // The CSS layout chain (app-content -> table-card -> ant-card-body
      // -> table-region) already stretches this box to fill whatever
      // vertical space is left, so its clientHeight is exactly the height
      // the table may occupy. We then subtract the non-scrolling parts
      // that live inside the same region (the fixed header + fixed summary
      // footer) so the scrollable body fills the region without an empty
      // gap or a double scrollbar. Falls back to the viewport-based
      // estimate when the DOM is not laid out yet (clientHeight === 0,
      // e.g. first paint).
      let y: number;
      const regionH = el.clientHeight;
      if (regionH > 0) {
        const thead = el.querySelector<HTMLElement>(".ant-table-thead");
        const summary = el.querySelector<HTMLElement>(
          ".ant-table-summary",
        );
        const overhead =
          (thead ? thead.getBoundingClientRect().height : 0) +
          (summary ? summary.getBoundingClientRect().height : 0);
        y = Math.max(150, Math.round(regionH - overhead) - 1);
      } else {
        const top = el.getBoundingClientRect().top;
        y = Math.max(150, window.innerHeight - top - 154);
      }
      setTableScrollY((prev) => (prev === y ? prev : y));
    });
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

  // "today" for the "bald abgelaufen" warning. Recomputed at most every few
  // minutes instead of on every render so rowClassName stays referentially
  // stable across resize re-renders.
  const nowMemo = useMemo(() => dayjs(), []);
  const warningThreshold = useMemo(() => nowMemo.add(1, "month"), [nowMemo]);
  const rowClassName = useCallback(
    (record: KontoData) =>
      record.endDatum.isBefore(warningThreshold) ? "row-warning" : "",
    [warningThreshold],
  );

  useEffect(() => {
    scheduleResize();
    window.addEventListener("resize", scheduleResize);
    const ro = new ResizeObserver(scheduleResize);
    if (tableRegionRef.current) ro.observe(tableRegionRef.current);
    return () => {
      window.removeEventListener("resize", scheduleResize);
      ro.disconnect();
      if (rafId.current != null) window.cancelAnimationFrame(rafId.current);
    };
  }, [scheduleResize]);

  // The .table-region is a flex item stretched by its parent, so its own
  // box size does NOT change when rows are added/removed and the
  // ResizeObserver above never fires for a data change. Without re-measuring
  // the scroll height stayed at the initial 300px fallback (the fallback
  // formula window.innerHeight - top - 154 happens to evaluate to ~300 for
  // a typical window when the first rAF runs before the flex layout has
  // resolved regionH), leaving the body permanently clipped at 300px even
  // though the region is much taller. Re-measure whenever the row count
  // changes - by then the async "load-data" has resolved and the flex chain
  // has settled, so regionH > 0 and the real available height is used.
  useEffect(() => {
    scheduleResize();
    const id = window.requestAnimationFrame(() => scheduleResize());
    return () => window.cancelAnimationFrame(id);
  }, [data, scheduleResize]);

  // Belt-and-suspenders: the very first rAF after mount can run before the
  // flex layout has given .table-region a non-zero height (so the fallback
  // kicks in). Re-measure a couple of times shortly after mount to catch
  // the settled layout for the empty-data case too.
  useEffect(() => {
    const t1 = window.setTimeout(scheduleResize, 50);
    const t2 = window.setTimeout(scheduleResize, 250);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [scheduleResize]);

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

  // Stable single-row calculators (no per-render allocation) used by the
  // table columns, summary cells and print/export routines.
  const calculateSingleInterest = useCallback(
    (entry: KontoData) => calculateInterest(entry, entry.startDatum, entry.endDatum),
    [],
  );

  const calculateQuarterlySingleInterest = useCallback(
    (entry: KontoData) => {
      if (!quartalsBeginn || !quartalsEnde) return 0;
      return calculateQuarterlyInterest(entry, quartalsBeginn, quartalsEnde);
    },
    [quartalsBeginn, quartalsEnde],
  );

  // Aggregate statistics memoized so a resize re-render (which now only
  // touches isNarrow/tableScrollY) never recomputes the interest sums, and
  // so the Statistic cards + Table.Summary receive stable numeric props.
  const totals = useMemo(() => {
    let totalNominal = 0;
    let totalInterest = 0;
    let totalPaid = 0;
    for (const entry of data) {
      totalNominal += entry.nominal;
      totalInterest += calculateInterest(entry, entry.startDatum, entry.endDatum);
      totalPaid += entry.verbuchteRueckstellung || 0;
    }
    return {
      nominal: totalNominal,
      interest: Math.round(totalInterest * 100) / 100,
      paid: totalPaid,
    };
  }, [data]);

  const quarterlyTotal = useMemo(() => {
    if (!quartalsBeginn || !quartalsEnde) return 0;
    let total = 0;
    for (const entry of data) {
      total += calculateQuarterlyInterest(entry, quartalsBeginn, quartalsEnde);
    }
    return Math.round(total * 100) / 100;
  }, [data, quartalsBeginn, quartalsEnde]);

  // Stable references consumed by Statistic cards / summary cells.
  const calculateTotalInterest = useCallback(() => totals.interest, [totals]);
  const calculateQuarterlyTotalInterest = useCallback(
    () => quarterlyTotal,
    [quarterlyTotal],
  );

  // Per-row accumulated interest (kumuliert bis Stichtag). Kept as a stable
  // callback so the table columns / summary do not re-create render fns
  // every render; it only changes identity when the Stichtag changes.
  const calculateAccumulatedInterest = useCallback(
    (entry: KontoData) => {
      if (!quartalsEnde) return 0;
      if (quartalsEnde.isBefore(entry.startDatum)) return 0;
      if (quartalsEnde.isAfter(entry.endDatum)) {
        return calculateInterest(entry, entry.startDatum, entry.endDatum);
      }
      return calculateInterest(entry, entry.startDatum, quartalsEnde);
    },
    [quartalsEnde],
  );

  // Memoized aggregate for the kumulierte Zinsen / Quartalszinsen columns
  // used in the Table.Summary footer, so resize re-renders stay cheap.
  const summaryAggregates = useMemo(() => {
    let accumulated = 0;
    let quarterly = 0;
    let reserve = 0;
    for (const entry of data) {
      const acc = calculateAccumulatedInterest(entry);
      accumulated += acc;
      const q = calculateQuarterlySingleInterest(entry);
      quarterly += q;
      reserve += q - (entry.verbuchteRueckstellung || 0);
    }
    return { accumulated, quarterly, reserve, paid: totals.paid };
  }, [data, calculateAccumulatedInterest, calculateQuarterlySingleInterest, totals.paid]);

  // Memoized summary node for the Anlagen table footer. Pre-formats the
  // memoized aggregates once and keeps the same element reference across
  // resize re-renders so the Table does not re-render its summary block.
  const tableSummary = useMemo(() => {
    const f2 = (v: number) =>
      v.toLocaleString("de-DE", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    return (
      <Table.Summary fixed>
        <Table.Summary.Row style={{ fontWeight: "bold" }}>
          <Table.Summary.Cell index={0}>Summe</Table.Summary.Cell>
          <Table.Summary.Cell index={1} />
          <Table.Summary.Cell index={2} />
          <Table.Summary.Cell index={3} />
          <Table.Summary.Cell index={4} />
          <Table.Summary.Cell index={5} />
          <Table.Summary.Cell index={6}>{f2(totals.nominal)}</Table.Summary.Cell>
          <Table.Summary.Cell align="end" index={7}>
            {f2(totals.interest)}
          </Table.Summary.Cell>
          <Table.Summary.Cell align="end" index={8}>
            {quartalsEnde ? f2(summaryAggregates.accumulated) : "0,00"}
          </Table.Summary.Cell>
          <Table.Summary.Cell align="end" index={9}>
            {quartalsBeginn && quartalsEnde ? f2(summaryAggregates.quarterly) : "0,00"}
          </Table.Summary.Cell>
          <Table.Summary.Cell align="end" index={10}>
            {f2(summaryAggregates.paid)}
          </Table.Summary.Cell>
          <Table.Summary.Cell align="end" index={11}>
            {f2(summaryAggregates.reserve)}
          </Table.Summary.Cell>
          <Table.Summary.Cell index={12} />
        </Table.Summary.Row>
      </Table.Summary>
    );
  }, [totals, summaryAggregates, quartalsBeginn, quartalsEnde]);

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

  const handleCheckForUpdates = async () => {
    if (!window.ipcRenderer || updateChecking) return;
    setUpdateChecking(true);
    setUpdateInfo(null);
    try {
      const result = await window.ipcRenderer.invoke("check-for-updates");
      if (result?.store) {
        // Microsoft Store build: the Store updates page was opened.
        setUpdateInfo(result);
        message.success(
          "Microsoft Store wurde geöffnet. Laden Sie dort die neueste Version herunter.",
        );
      } else if (result?.status === "up-to-date") {
        setUpdateInfo(result);
        message.success("Zinsrechner ist bereits auf dem neuesten Stand.");
      } else if (result?.status === "available") {
        setUpdateInfo(result);
        message.info(
          `Update auf Version ${result.version} wird heruntergeladen…`,
        );
      } else if (result?.status === "error") {
        setUpdateInfo(result);
        message.error(
          `Update-Prüfung fehlgeschlagen: ${result.message ?? "unbekannter Fehler"}`,
        );
      }
    } catch (error) {
      message.error("Update-Prüfung fehlgeschlagen.");
      console.error(error);
    } finally {
      setUpdateChecking(false);
    }
  };

  const handleInstallUpdate = async () => {
    if (!window.ipcRenderer) return;
    const result = await window.ipcRenderer.invoke("install-update");
    if (!result?.ok) message.error("Update konnte nicht installiert werden.");
  };

  // Check once on startup (and then hourly) whether a newer version is
  // published. The "Aktualisieren" button is only rendered when an update
  // is actually available, so the toolbar stays clean otherwise.
  useEffect(() => {
    if (!window.ipcRenderer) return;
    let cancelled = false;
    const check = () =>
      window.ipcRenderer
        .invoke("check-update-available")
        .then((r: { available: boolean; latest?: string }) => {
          if (!cancelled) setUpdateAvailable(!!r?.available);
        })
        .catch(() => {});
    check();
    const id = window.setInterval(check, 60 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Listen to live updater progress / status events from the main process.
  useEffect(() => {
    if (!window.ipcRenderer) return;
    const handler = (
      _e: import("electron").IpcRendererEvent,
      payload: {
        status: string;
        version?: string;
        message?: string;
        percent?: number;
      },
    ) => {
      if (payload.status === "downloaded") {
        setUpdateInfo({ status: "downloaded", version: payload.version });
        message.success("Update heruntergeladen. Jetzt installieren?");
      } else if (payload.status === "up-to-date") {
        setUpdateInfo({ status: "up-to-date" });
      } else if (payload.status === "downloading") {
        setUpdateInfo({
          status: "downloading",
          version: payload.version,
          message: payload.percent != null ? `${payload.percent}%` : undefined,
        });
      } else if (payload.status === "error") {
        setUpdateInfo({ status: "error", message: payload.message });
        message.error(
          `Update fehlgeschlagen: ${payload.message ?? "unbekannter Fehler"}`,
        );
      }
    };
    window.ipcRenderer.on("update-status", handler);
    return () => {
      window.ipcRenderer?.off?.("update-status", handler);
    };
  }, []);

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

  const historyPreviewRows = useMemo(() => {
    const rows = buildHistoryRows(data);
    if (rows.length === 0) return rows;
    const today = dayjs();
    const parseDatum = (d: string) => dayjs(d, "DD.MM.YYYY");
    // Find insertion index: after last row with datum <= today
    let insertIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      if (parseDatum(rows[i].datum).isBefore(today) || parseDatum(rows[i].datum).isSame(today, "day")) {
        insertIdx = i;
      }
    }
    // Compute running sum up to insertIdx
    let sum = 0;
    for (let i = 0; i <= insertIdx; i++) {
      if (rows[i].ereignis === "Eröffnung") sum += rows[i].menge;
      if (rows[i].ereignis === "Ablauf") sum -= rows[i].menge;
    }
    if (insertIdx >= 0) {
      const todayRow: HistoryRow = {
        datum: today.format("DD.MM.YYYY"),
        bankName: "⟶ Summe heute",
        menge: sum,
        prozent: 0,
        wachstum: null,
        ereignis: "Summe",
        aenderung: "none",
      };
      const result = [...rows];
      result.splice(insertIdx + 1, 0, todayRow);
      return result;
    }
    return rows;
  }, [data]);
  // Memoize the history chart config so merely toggling the
  // Diagramm/Tabelle switch does NOT recompute running totals nor
  // create new lineData/options/plugin objects (which would force
  // Chart.js to fully destroy and recreate the chart = visible lag).
  // Only data-affecting dependencies invalidate the memo.
  const historyChart = useMemo(() => {
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
    
              // When groups are configured, render one stacked area per group so
          // the areas stack on top of each other and visually sum up to the
          // total. Without groups we keep the single "Gesamt" filled area.
          const hasGroups = historyGroups.length > 0;
              const datasetNames = hasGroups
                ? historyGroups.map((g) => g.name)
                : ["Gesamt"];
    
              // When groups are configured the diagram is additive by area:
              // every group is drawn as a stacked area on top of the previous
              // one, so the areas sum up to the total. The "Gesamt" line is then
              // drawn as the border on top of the last stacked group: it is a
              // stacked line-only dataset whose value is the residual between the
              // sum of the group running totals and the true overall total, so its
              // plotted position lands exactly on the true Gesamt value. The area
              // beneath that border line is the additive sum of the group colors
              // (two groups => filled by two colors). Without groups we keep the
              // single "Gesamt" filled area.
              const groupSumAt = (idx: number) =>
                hasGroups
                  ? historyGroups.reduce(
                      (acc, g) => acc + (runningTotals[g.name]?.[idx] ?? 0),
                      0,
                    )
                  : 0;
              const gesamtResidual = runningTotals["Gesamt"].map((v, idx) =>
                Math.max(0, v - groupSumAt(idx)),
              );
    
              const lineData = {
                labels: dates,
                datasets: [
                  ...datasetNames.map((name, i) => ({
                    label: name,
                    data: runningTotals[name],
                    borderColor: colors[i % colors.length],
                    backgroundColor: colors[i % colors.length] + "44",
                    fill: hasGroups ? ("stack" as const) : true,
                    tension: 0.3,
                    borderWidth: 2,
                  })),
                  // The Gesamt summary line: a stacked, line-only dataset whose
                  // value is the residual up to the true total. Because it is
                  // stacked it plots at the cumulative top (= true Gesamt), i.e. it
                  // is drawn as the border on top of the last stacked group. The
                  // area beneath it stays filled by the group colors (additive by
                  // area); this dataset only adds the top border line. The residual
                  // is 0 when the groups cover every bank, so the line then sits
                  // flush on top of the stacked group areas.
                  ...(hasGroups
                    ? [{
                        // Join the shared stack so this dataset's line is drawn at
                        // the cumulative top (= sum of all group running totals +
                        // residual = true Gesamt), i.e. the top border line above
                        // the last group. fill: "stack" keeps it in the stack
                        // (line stacks on top of the previous dataset); the
                        // residual band between the last group and the Gesamt line
                        // is effectively invisible because backgroundColor is
                        // transparent and the residual is 0 when the groups cover
                        // every bank.
                        label: "Gesamt",
                        data: gesamtResidual,
                        borderColor: "#000000",
                        backgroundColor: "transparent",
                        fill: "stack" as const,
                        tension: 0.3,
                        borderWidth: 3,
                        borderDash: [] as number[],
                      }]
                    : []),
                ],
              };
    
              // Find today's index in dates for vertical line
              const todayStr = dayjs().format("DD.MM.YYYY");
              const todayIndex = dates.indexOf(todayStr);
              // Find the closest date <= today if exact match not found
              const todayParsed = dayjs();
              let todayLineIndex = todayIndex;
              if (todayLineIndex === -1) {
                for (let i = dates.length - 1; i >= 0; i--) {
                  const d = dayjs(dates[i], "DD.MM.YYYY");
                  if (d.isBefore(todayParsed) || d.isSame(todayParsed, "day")) {
                    todayLineIndex = i;
                    break;
                  }
                }
              }
              const todayGesamtValue = todayLineIndex >= 0 ? runningTotals["Gesamt"][todayLineIndex] : null;
    
              const todayLinePlugin = {
                id: "todayLine",
                afterDraw(chart: any) {
                  if (todayLineIndex < 0) return;
                  const xScale = chart.scales.x;
                  const yScale = chart.scales.y;
                  const x = xScale.getPixelForValue(todayLineIndex);
                  const ctx = chart.ctx;
                  ctx.save();
                  ctx.beginPath();
                  ctx.moveTo(x, yScale.top);
                  ctx.lineTo(x, yScale.bottom);
                  ctx.lineWidth = 2;
                  ctx.strokeStyle = "#1677ff";
                  ctx.setLineDash([6, 4]);
                  ctx.stroke();
                  ctx.setLineDash([]);
                  // Label
                  if (todayGesamtValue !== null) {
                    const label = `Heute: ${todayGesamtValue.toLocaleString("de-DE")} €`;
                    ctx.fillStyle = "#1677ff";
                    ctx.font = "bold 12px Arial";
                    ctx.textAlign = "left";
                    ctx.fillText(label, x + 4, yScale.top + 16);
                  }
                  ctx.restore();
                },
              };
    
              const lineOptions = {
                responsive: true,
                interaction: {
                  // Hover snaps to the nearest x-index (vertical line through the
                  // cursor) so hovering any area surfaces the nearest point in the
                  // vertical, showing every stacked group plus the Gesamt summary.
                  mode: "index" as const,
                  intersect: false,
                },
                plugins: {
                  title: { display: true, text: "Veranlagungsverlauf (kumulativ)" },
                  legend: { position: "top" as const },
                  tooltip: {
                    mode: "index" as const,
                    intersect: false,
                    callbacks: {
                      label: (ctx: any) => {
                        const name = ctx.dataset.label ?? "";
                        // The Gesamt dataset carries only the residual so it
                        // stacks up to the true total; for the tooltip show the
                        // real Gesamt value, not the residual.
                        const val =
                          name === "Gesamt"
                            ? (runningTotals["Gesamt"][ctx.dataIndex] ?? 0)
                            : Number(ctx.parsed.y);
                        return `${name}: ${val.toLocaleString("de-DE")} �`;
                      },
                    },
                  },
                },
                scales: {
                  y: {
                    beginAtZero: true,
                stacked: hasGroups,
                    ticks: {
                      callback: (v: unknown) =>
                        Number(v).toLocaleString("de-DE") + " €",
                    },
                  },
                },
              };
    return { lineData, lineOptions, plugins: [todayLinePlugin] };
  }, [historyPreviewRows, historyGroups]);

  // Memoized columns for the Historie table so toggling the
  // Diagramm/Tabelle switch does not rebuild the columns array (which
  // would otherwise force the Antd Table to re-diff every cell).
  const historyColumns = useMemo(
    () => [
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
                  record.ereignis === "Summe"
                    ? record.menge.toLocaleString("de-DE", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    : record.ereignis === "Eröffnung" &&
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
                    record.ereignis === "Eröffnung" || record.ereignis === "Summe"
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
    ],
    [historyGroups],
  );

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
          {(updateAvailable ||
            updateInfo?.status === "downloaded" ||
            updateInfo?.status === "downloading") && (
            <Tooltip
              title={
                updateInfo?.status === "downloaded"
                  ? "Update installieren und neu starten"
                  : updateInfo?.status === "downloading"
                    ? `Update wird heruntergeladen${updateInfo.message ? ` (${updateInfo.message})` : ""}…`
                    : "Nach Update suchen (Microsoft Store)"
              }
            >
              <Button
                type="text"
                aria-label="Aktualisieren"
                icon={
                  updateChecking || updateInfo?.status === "downloading" ? (
                    <SyncOutlined spin />
                  ) : (
                    <SyncOutlined />
                  )
                }
                onClick={
                  updateInfo?.status === "downloaded"
                    ? handleInstallUpdate
                    : handleCheckForUpdates
                }
              >
                {updateInfo?.status === "downloaded"
                  ? "Installieren"
                  : "Aktualisieren"}
              </Button>
            </Tooltip>
          )}
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

      <Layout className="app-body">
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
                    suffix="%"
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
                    suffix="€"
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
                value={totals.nominal}
                precision={2}
              />
            </Card>
            <Card className="stat-card" size="small">
              <Statistic
                title="Gesamtzinsen (€)"
                value={totals.interest}
                precision={2}
              />
            </Card>
            <Card className="stat-card" size="small">
              <Statistic
                title="Quartalszinsen (€)"
                value={quarterlyTotal}
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
                value={quarterlyTotal}
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
                rowKey={(record) =>
                  `${record.bankName}-${record.kontoNumber}-${record.startDatum.toISOString()}`
                }
                pagination={false}
                size="middle"
                bordered
                scroll={{ x: "max-content", y: tableScrollY }}
                locale={{ emptyText: "Keine Anlagen erfasst" }}
                rowClassName={rowClassName}
                summary={() => tableSummary}
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
        destroyOnHidden
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
          rowKey={(record) =>
            `${record.datum}-${record.bankName}-${record.ereignis}-${record.menge}-${record.prozent}`
          }
          rowClassName={(record) =>
            record.ereignis === "Summe" ? "history-today-row" : ""
          }
          columns={historyColumns}
        />
        ) : historyChart ? (
            <div style={{ height: "65vh", display: "flex", alignItems: "center" }}>
              <Line data={historyChart.lineData} options={historyChart.lineOptions} plugins={historyChart.plugins} />
            </div>
          ) : null}
      </Modal>

      <Modal
        title="Historie-Gruppen konfigurieren"
        open={groupConfigOpen}
        onCancel={() => setGroupConfigOpen(false)}
        destroyOnHidden
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

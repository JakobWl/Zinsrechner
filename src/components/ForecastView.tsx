import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  InputNumber,
  Segmented,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import dayjs, { Dayjs } from "dayjs";
import type { KontoData } from "../utils/interestCalculation";
import {
  currentAverageRatePp,
  expiringNominalByYear,
} from "../utils/forecast";

const { Title, Text } = Typography;

/* ------------------------------------------------------------------------- */
/* Datenmodell: NUR Einstellungen, niemals berechnete Werte                    */
/* ------------------------------------------------------------------------- */

/**
 * Eine Prognose-Gruppe ist ausschließlich eine Nutzer-Einstellung:
 * Bezeichnung + Anteil am Anlagevolumen. Nominal- und Zinswerte werden
 * daraus **immer** neu aus den Konten berechnet.
 */
export interface ForecastGroup {
  id: string;
  label: string;
  sharePp: number;
}

/** Persistierter Zustand: ausschließlich Einstellungen. */
export interface ForecastState {
  version: 2;
  horizonYears: number;
  groups: ForecastGroup[];
}

export const FORECAST_STATE_VERSION = 2 as const;

export const HORIZON_OPTIONS = [3, 5, 10] as const;
const MIN_HORIZON = 1;
const MAX_HORIZON = 15;

export function defaultForecastState(): ForecastState {
  return {
    version: FORECAST_STATE_VERSION,
    horizonYears: 5,
    groups: [{ id: "base", label: "Basis-Szenario", sharePp: 100 }],
  };
}

function clampHorizon(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return defaultForecastState().horizonYears;
  return Math.min(MAX_HORIZON, Math.max(MIN_HORIZON, Math.round(parsed)));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

let uidCounter = 0;
function nextGroupId(): string {
  uidCounter += 1;
  return `group-${Date.now().toString(36)}-${uidCounter}`;
}

function normalizeForecastState(state: ForecastState): ForecastState {
  const groups = (Array.isArray(state.groups) ? state.groups : [])
    .filter((group) => group && typeof group === "object")
    .map((group) => ({
      id: String(group.id || nextGroupId()),
      label: String(group.label ?? "").trim() || "Gruppe",
      sharePp: Number.isFinite(Number(group.sharePp))
        ? Math.min(100, Math.max(0, round2(Number(group.sharePp))))
        : 0,
    }));

  return {
    version: FORECAST_STATE_VERSION,
    horizonYears: clampHorizon(state.horizonYears),
    groups: groups.length > 0 ? groups : defaultForecastState().groups,
  };
}

/**
 * Liest gespeicherte Prognose-Einstellungen und **verwirft** alle früher
 * mitgeschriebenen Berechnungswerte (Nominal-/Zins-Matrix, `savedAt`).
 * Alte Dateien mit `variants[].cells` werden nur als Label-/Anteils-Quelle
 * migriert, nie als Rechenergebnis übernommen.
 */
export function parseForecastState(raw: unknown): ForecastState {
  if (!raw) return defaultForecastState();

  let value: any = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return defaultForecastState();
    }
  }
  if (!value || typeof value !== "object") return defaultForecastState();

  // Aktuelles Format (v2+): nur Einstellungen.
  if (Array.isArray(value.groups)) {
    return normalizeForecastState({
      version: FORECAST_STATE_VERSION,
      horizonYears: clampHorizon(value.horizonYears),
      groups: value.groups,
    });
  }

  // Altformat (v1): variants[].cells werden bewusst ignoriert.
  if (Array.isArray(value.variants)) {
    return normalizeForecastState({
      version: FORECAST_STATE_VERSION,
      horizonYears: clampHorizon(value.horizonYears),
      groups: value.variants.map((variant: any, index: number) => ({
        id: String(variant?.id ?? `group-${index + 1}`),
        label: String(variant?.label ?? `Variante ${index + 1}`),
        sharePp: Number(variant?.sharePp ?? 0),
      })),
    });
  }

  return defaultForecastState();
}

/* ------------------------------------------------------------------------- */
/* Ableitung aus Konten                                                       */
/* ------------------------------------------------------------------------- */

export interface ForecastYearAggregate {
  year: number;
  /** Nominal der am Jahresende noch laufenden Veranlagungen. */
  nominal: number;
  /** Nach Nominal gewichteter Durchschnittszins des Bestands (in %). */
  ratePp: number;
  /** Zinsertrag des Jahres aus den Konten (anteilig für Rumpfjahre). */
  interest: number;
  /** Nominal, das im Jahr fällig wird (Wiederanlage-Bedarf). */
  expiring: number;
  /** Anzahl der im Jahr verzinsten Konten. */
  accountCount: number;
}

function yearBounds(year: number) {
  const yearStart = dayjs(`${year}-01-01`).startOf("day");
  const yearEnd = dayjs(`${year}-12-31`).startOf("day");
  return { yearStart, yearEnd };
}

function overlapBounds(start: Dayjs, end: Dayjs, year: number) {
  const { yearStart, yearEnd } = yearBounds(year);
  const from = start.isAfter(yearStart) ? start : yearStart;
  const to = end.isBefore(yearEnd) ? end : yearEnd;
  if (to.isBefore(from, "day")) return null;
  return { from, to, yearStart, yearEnd };
}

/** Zinsen eines Kontos in einem Kalenderjahr (nur Überlappung mit Laufzeit). */
export function accountInterestInYear(
  account: KontoData,
  year: number,
  start: Dayjs,
): number {
  const accountStart = dayjs(account.startDatum).startOf("day");
  const accountEnd = dayjs(account.endDatum).startOf("day");
  const overlap = overlapBounds(accountStart, accountEnd, year);
  if (!overlap) return 0;
  const from = overlap.from.isBefore(start, "day") ? start : overlap.from;
  if (overlap.to.isBefore(from, "day")) return 0;

  const days = overlap.to.diff(from, "day") + 1;
  const yearDays = overlap.yearEnd.diff(overlap.yearStart, "day") + 1;
  if (days <= 0 || yearDays <= 0) return 0;

  const interest = account.nominal * (account.zinssatz / 100) * (days / yearDays);
  return round2(interest);
}

/** Bestand (Nominal) der zu einem Stichtag laufenden Konten. */
function nominalAtDate(accounts: KontoData[], date: Dayjs): number {
  return round2(
    accounts.reduce((sum, account) => {
      const accountStart = dayjs(account.startDatum).startOf("day");
      const accountEnd = dayjs(account.endDatum).startOf("day");
      if (accountStart.isAfter(date, "day")) return sum;
      if (accountEnd.isBefore(date, "day")) return sum;
      return sum + account.nominal;
    }, 0),
  );
}

function weightedRateAtDate(accounts: KontoData[], date: Dayjs): number {
  let nominal = 0;
  let weighted = 0;
  accounts.forEach((account) => {
    const accountStart = dayjs(account.startDatum).startOf("day");
    const accountEnd = dayjs(account.endDatum).startOf("day");
    if (accountStart.isAfter(date, "day")) return;
    if (accountEnd.isBefore(date, "day")) return;
    nominal += account.nominal;
    weighted += account.nominal * account.zinssatz;
  });
  if (nominal <= 0) return 0;
  return round4(weighted / nominal);
}

/**
 * Kern der Prognose: Jahreswerte werden vollständig aus den Konten abgeleitet.
 * Es gibt keinen gespeicherten Eingabewert außer dem Zeithorizont.
 */
export function forecastYearAggregates(
  accounts: KontoData[],
  state: ForecastState,
  start: Dayjs | string,
): ForecastYearAggregate[] {
  const anchor = dayjs(start).startOf("day");
  const horizon = clampHorizon(state?.horizonYears);
  const years = Array.from({ length: horizon }, (_, index) => anchor.year() + index);
  const expiring = expiringNominalByYear(accounts, anchor, years);

  return years.map((year, index) => {
    const snapshot = dayjs(`${year}-12-31`).startOf("day");
    const interest = round2(
      accounts.reduce(
        (sum, account) => sum + accountInterestInYear(account, year, anchor),
        0,
      ),
    );
    const accountCount = accounts.filter((account) => {
      const accountStart = dayjs(account.startDatum).startOf("day");
      const accountEnd = dayjs(account.endDatum).startOf("day");
      return !accountStart.isAfter(snapshot, "day") && !accountEnd.isBefore(anchor, "day");
    }).length;

    return {
      year,
      nominal: nominalAtDate(accounts, snapshot),
      ratePp: weightedRateAtDate(accounts, snapshot),
      interest,
      expiring: expiring[index] ?? 0,
      accountCount,
    };
  });
}

export interface ForecastSplitRow {
  id: string;
  label: string;
  sharePp: number;
  nominalByYear: number[];
  interestByYear: number[];
  nominalTotal: number;
  interestTotal: number;
}

/** Aufteilung je Gruppe: Nominal und Zinsen werden nur umgelegt, nicht gespeichert. */
export function forecastSplitRows(
  aggregates: ForecastYearAggregate[],
  state: ForecastState,
  start: Dayjs | string,
): ForecastSplitRow[] {
  const anchor = dayjs(start).startOf("day");
  return normalizeForecastState(state).groups.map((group) => {
    const factor = group.sharePp / 100;
    const nominalByYear = aggregates.map((row) => round2(row.nominal * factor));
    const interestByYear = aggregates.map((row) => {
      const snapshot = dayjs(`${row.year}-12-31`).startOf("day");
      const yearStart = dayjs(`${row.year}-01-01`).startOf("day");
      const from = anchor.isAfter(yearStart) ? anchor : yearStart;
      if (from.isAfter(snapshot, "day")) return 0;
      const days = snapshot.diff(from, "day") + 1;
      const yearDays = snapshot.diff(yearStart, "day") + 1;
      return round2(row.nominal * factor * (row.ratePp / 100) * (days / yearDays));
    });
    return {
      id: group.id,
      label: group.label,
      sharePp: group.sharePp,
      nominalByYear,
      interestByYear,
      nominalTotal: round2(nominalByYear.reduce((sum, value) => sum + value, 0)),
      interestTotal: round2(interestByYear.reduce((sum, value) => sum + value, 0)),
    };
  });
}

/* ------------------------------------------------------------------------- */
/* Formatierung                                                               */
/* ------------------------------------------------------------------------- */

const eur = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const pct = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatEur(value: number): string {
  return eur.format(Number.isFinite(value) ? value : 0);
}

function formatPct(value: number): string {
  return `${pct.format(Number.isFinite(value) ? value : 0)} %`;
}

/* ------------------------------------------------------------------------- */
/* Komponente                                                                 */
/* ------------------------------------------------------------------------- */

interface ForecastViewProps {
  accounts: KontoData[];
  onBack?: () => void;
  initialForecast?: unknown;
  onForecastChange?: (state: ForecastState) => void;
}

export default function ForecastView({
  accounts,
  onBack,
  initialForecast,
  onForecastChange,
}: ForecastViewProps) {
  // Stichtag wird beim Öffnen fixiert, damit die Anzeige während des
  // Bearbeitens stabil bleibt – die Werte selbst kommen immer aus den Konten.
  const start = useRef<Dayjs>(dayjs().startOf("day")).current;

  const [settings, setSettings] = useState<ForecastState>(() =>
    parseForecastState(initialForecast),
  );

  const changeHandler = useRef(onForecastChange);
  changeHandler.current = onForecastChange;

  const applySettings = useCallback((next: ForecastState) => {
    const normalized = normalizeForecastState(next);
    setSettings(normalized);
    changeHandler.current?.(normalized);
  }, []);

  const accountsList = useMemo(() => accounts ?? [], [accounts]);

  // Alles Folgende ist reine Ableitung aus den Konten.
  const aggregates = useMemo(
    () => forecastYearAggregates(accountsList, settings, start),
    [accountsList, settings, start],
  );

  const splitRows = useMemo(
    () => forecastSplitRows(aggregates, settings, start),
    [aggregates, settings, start],
  );

  const runningAccounts = useMemo(
    () =>
      accountsList
        .filter(
          (account) =>
            !dayjs(account.endDatum).startOf("day").isBefore(start, "day"),
        )
        .sort(
          (a, b) =>
            dayjs(a.endDatum).valueOf() - dayjs(b.endDatum).valueOf(),
        ),
    [accountsList, start],
  );

  const runningNominal = round2(
    runningAccounts.reduce((sum, account) => sum + account.nominal, 0),
  );
  const runningRatePp = currentAverageRatePp(runningAccounts);
  const totalInterest = round2(
    aggregates.reduce((sum, row) => sum + row.interest, 0),
  );
  const totalExpiring = round2(
    aggregates.reduce((sum, row) => sum + row.expiring, 0),
  );
  const shareSum = round2(
    settings.groups.reduce((sum, group) => sum + group.sharePp, 0),
  );
  const shareOk = Math.abs(shareSum - 100) < 0.005;
  const years = aggregates.map((row) => row.year);

  const updateGroup = (id: string, patch: Partial<ForecastGroup>) => {
    applySettings({
      ...settings,
      groups: settings.groups.map((group) =>
        group.id === id ? { ...group, ...patch } : group,
      ),
    });
  };

  const addGroup = () => {
    const used = settings.groups.reduce((sum, group) => sum + group.sharePp, 0);
    const rest = Math.max(0, round2(100 - used));
    applySettings({
      ...settings,
      groups: [
        ...settings.groups,
        {
          id: nextGroupId(),
          label: `Variante ${settings.groups.length + 1}`,
          sharePp: rest,
        },
      ],
    });
  };

  const removeGroup = (id: string) => {
    if (settings.groups.length <= 1) return;
    applySettings({
      ...settings,
      groups: settings.groups.filter((group) => group.id !== id),
    });
  };

  /* ----------------------------- Tabellen ------------------------------- */

  const matrixColumns = [
    {
      title: "Kennzahl",
      dataIndex: "label",
      key: "label",
      width: 200,
      fixed: "left" as const,
      render: (value: string) => <Text strong>{value}</Text>,
    },
    ...aggregates.map((row) => ({
      title: String(row.year),
      key: `year-${row.year}`,
      align: "right" as const,
      render: (_: unknown, record: { key: string; values: number[]; format: (n: number) => string }) => (
        <span className={record.key === "interest" ? "forecast-cell-interest" : "forecast-cell"}>
          {record.format(record.values[years.indexOf(row.year)] ?? 0)}
        </span>
      ),
    })),
    {
      title: "Summe",
      key: "total",
      align: "right" as const,
      render: (_: unknown, record: { total: string }) => <Text strong>{record.total}</Text>,
    },
  ];

  const matrixData = [
    {
      key: "nominal",
      label: "Bestand 31.12.",
      values: aggregates.map((row) => row.nominal),
      format: formatEur,
      total: formatEur(round2(aggregates.reduce((sum, row) => sum + row.nominal, 0))),
    },
    {
      key: "rate",
      label: "Ø-Zins (gewichtet)",
      values: aggregates.map((row) => row.ratePp),
      format: formatPct,
      total: formatPct(runningRatePp),
    },
    {
      key: "interest",
      label: "Zinsen im Jahr",
      values: aggregates.map((row) => row.interest),
      format: formatEur,
      total: formatEur(totalInterest),
    },
    {
      key: "expiring",
      label: "Ablaufendes Nominal",
      values: aggregates.map((row) => row.expiring),
      format: formatEur,
      total: formatEur(totalExpiring),
    },
    {
      key: "count",
      label: "Verzinste Konten",
      values: aggregates.map((row) => row.accountCount),
      format: (value: number) => String(Math.round(value)),
      total: `${runningAccounts.length}`,
    },
  ];

  const splitColumns = [
    {
      title: "Variante",
      dataIndex: "label",
      key: "label",
      width: 240,
      fixed: "left" as const,
      render: (value: string, record: ForecastSplitRow) => (
        <Space direction="vertical" size={2} style={{ width: "100%" }}>
          <Text strong>{value}</Text>
          <Space size={6} className="forecast-split-controls">
            <InputNumber
              size="small"
              min={0}
              max={100}
              step={5}
              value={record.sharePp}
              addonAfter="%"
              style={{ width: 110 }}
              onChange={(next) =>
                updateGroup(record.id, {
                  sharePp: Number.isFinite(Number(next)) ? Number(next) : 0,
                })
              }
            />
            <Tooltip title="Variante entfernen">
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                disabled={settings.groups.length <= 1}
                onClick={() => removeGroup(record.id)}
              />
            </Tooltip>
          </Space>
        </Space>
      ),
    },
    ...years.map((year, index) => ({
      title: String(year),
      key: `split-${year}`,
      align: "right" as const,
      render: (_: unknown, record: ForecastSplitRow) => (
        <Space direction="vertical" size={0} style={{ alignItems: "flex-end" }}>
          <span className="forecast-split-nominal forecast-split-cell">
            {formatEur(record.nominalByYear[index] ?? 0)}
          </span>
          <span className="forecast-split-interest forecast-split-amount">
            {formatEur(record.interestByYear[index] ?? 0)}
          </span>
        </Space>
      ),
    })),
    {
      title: "Zinsen gesamt",
      key: "split-total",
      align: "right" as const,
      render: (_: unknown, record: ForecastSplitRow) => (
        <Text strong>{formatEur(record.interestTotal)}</Text>
      ),
    },
  ];

  const accountColumns = [
    {
      title: "Bank",
      dataIndex: "bankName",
      key: "bankName",
      render: (value: string) => <Text strong>{value || "—"}</Text>,
    },
    {
      title: "Konto",
      dataIndex: "kontoNumber",
      key: "kontoNumber",
      render: (value: string) => value || "—",
    },
    {
      title: "Nominal",
      dataIndex: "nominal",
      key: "nominal",
      align: "right" as const,
      render: (value: number) => formatEur(value),
    },
    {
      title: "Zins",
      dataIndex: "zinssatz",
      key: "zinssatz",
      align: "right" as const,
      render: (value: number) => formatPct(value),
    },
    {
      title: "Laufzeit bis",
      dataIndex: "endDatum",
      key: "endDatum",
      align: "right" as const,
      render: (value: Dayjs | string) => dayjs(value).format("DD.MM.YYYY"),
    },
  ];

  /* ------------------------------- Render ------------------------------- */

  return (
    <div className="forecast-page">
      <div className="forecast-head">
        <Space size="middle" align="center" wrap>
          {onBack ? (
            <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
              Zurück
            </Button>
          ) : null}
          <Title level={4} style={{ margin: 0 }}>
            Zinsprognose
          </Title>
          <Tag color="blue">aus Konten berechnet</Tag>
        </Space>
        <Space size="middle" align="center" wrap className="forecast-control">
          <Text type="secondary">Horizont</Text>
          <Segmented
            options={HORIZON_OPTIONS.map((value) => ({
              label: `${value} Jahre`,
              value,
            }))}
            value={
              (HORIZON_OPTIONS as readonly number[]).includes(settings.horizonYears)
                ? settings.horizonYears
                : HORIZON_OPTIONS[0]
            }
            onChange={(value) =>
              applySettings({ ...settings, horizonYears: Number(value) })
            }
          />
          <Tooltip title="Alle Werte neu aus den Konten berechnen">
            <Button
              icon={<ReloadOutlined />}
              onClick={() => applySettings({ ...settings })}
            >
              Neu berechnen
            </Button>
          </Tooltip>
        </Space>
      </div>

      <div className="stat-grid">
        <Card className="stat-card forecast-stat-merged" size="small">
          <div className="forecast-stat-rows">
            <div className="forecast-stat-row">
              <span className="forecast-stat-label">Aktuelles Nominal</span>
              <span className="forecast-stat-value">{formatEur(runningNominal)}</span>
              <span className="forecast-stat-tag">{runningAccounts.length} Konten</span>
            </div>
            <div className="forecast-stat-row">
              <span className="forecast-stat-label">Ø-Zins (gewichtet)</span>
              <span className="forecast-stat-value">{formatPct(runningRatePp)}</span>
              <span className="forecast-stat-hint">aus laufenden Konten</span>
            </div>
          </div>
        </Card>
        <Card className="stat-card forecast-stat-merged" size="small">
          <div className="forecast-stat-rows">
            <div className="forecast-stat-row">
              <span className="forecast-stat-label">
                Zinsen {years[0]}–{years[years.length - 1]}
              </span>
              <span className="forecast-stat-value">{formatEur(totalInterest)}</span>
              <span className="forecast-stat-tag">kumuliert</span>
            </div>
            <div className="forecast-stat-row">
              <span className="forecast-stat-label">Ablaufendes Nominal</span>
              <span className="forecast-stat-value">{formatEur(totalExpiring)}</span>
              <span className="forecast-stat-hint">im Horizont</span>
            </div>
          </div>
        </Card>
        <Card className="stat-card forecast-stat-merged" size="small">
          <div className="forecast-stat-rows">
            <div className="forecast-stat-row">
              <span className="forecast-stat-label">Erster Ablauf</span>
              <span className="forecast-stat-value">
                {runningAccounts.length > 0
                  ? dayjs(runningAccounts[0].endDatum).format("DD.MM.YYYY")
                  : "—"}
              </span>
              <span className="forecast-stat-tag">
                {shareOk ? "Anteile 100 %" : `Anteile ${pct.format(shareSum)} %`}
              </span>
            </div>
            <div className="forecast-stat-row">
              <span className="forecast-stat-label">Stichtag</span>
              <span className="forecast-stat-value">{start.format("DD.MM.YYYY")}</span>
              <span className="forecast-stat-hint">Berechnungsbasis</span>
            </div>
          </div>
        </Card>
      </div>

      {accountsList.length === 0 ? (
        <Alert
          type="info"
          showIcon
          message="Keine Konten vorhanden"
          description="Die Prognose wird ausschließlich aus Ihren Konten berechnet. Legen Sie Konten an, damit hier Werte erscheinen."
        />
      ) : null}

      <Card
        className="forecast-card"
        title="Jahreswerte aus den Konten"
        size="small"
        extra={<Text type="secondary">Nominal, Zins und Zinsertrag je Kalenderjahr</Text>}
      >
        <Table
          className="forecast-matrix"
          size="small"
          pagination={false}
          scroll={{ x: "max-content" }}
          columns={matrixColumns}
          dataSource={matrixData}
        />
        <div className="forecast-hint">
          Alle Werte dieser Tabelle werden bei jedem Aufruf neu aus den Konten
          berechnet – gespeichert werden nur Horizont und Variantenanteile.
        </div>
      </Card>

      <Card
        className="forecast-card"
        title="Aufteilung nach Varianten"
        size="small"
        extra={
          <Space size="small">
            <Text type="secondary">Anteil am Volumen</Text>
            <Button size="small" icon={<PlusOutlined />} onClick={addGroup}>
              Variante
            </Button>
          </Space>
        }
      >
        {!shareOk ? (
          <div className="forecast-split-alert">
            <Alert
              type="warning"
              showIcon
              message={`Summe der Anteile: ${pct.format(shareSum)} %`}
              description="Die Anteile sollten zusammen 100 % ergeben, damit die Aufteilung dem Kontobestand entspricht."
            />
          </div>
        ) : null}
        <Table
          className="forecast-split-table"
          size="small"
          pagination={false}
          scroll={{ x: "max-content" }}
          rowClassName={() => "forecast-split-year-row"}
          columns={splitColumns}
          dataSource={splitRows}
          rowKey="id"
        />
        <div className="forecast-hint">
          Jede Zeile zeigt Nominal und Zinsen (kleiner Wert) für das jeweilige
          Jahr, berechnet aus Kontobestand × Anteil.
        </div>
      </Card>

      <Card
        className="forecast-card"
        title="Laufende Veranlagungen"
        size="small"
        extra={<Text type="secondary">{runningAccounts.length} Konten</Text>}
      >
        <Table
          size="small"
          pagination={false}
          scroll={{ x: "max-content" }}
          columns={accountColumns}
          dataSource={runningAccounts}
          rowKey={(record: KontoData, index?: number) =>
            String((record as any).id ?? `${record.bankName}-${(record as any).kontoNumber ?? index}`)
          }
        />
      </Card>

      <div className="forecast-disclaimer">
        Die Prognose ist eine Ableitung aus den aktuell erfassten Konten
        (Nominal, Zinssatz, Laufzeit, Zinsmethode) und dem gewählten Horizont.
        Es werden keine berechneten Zahlen gespeichert; Änderungen an den Konten
        verändern die Prognose unmittelbar.
      </div>
    </div>
  );
}

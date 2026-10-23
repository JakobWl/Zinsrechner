import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  InputNumber,
  Segmented,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { TableProps } from "antd";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import { calculateInterest } from "../utils/interestCalculation";
import type { KontoData } from "../utils/interestCalculation";
import { currentAverageRatePp, expiringNominalByYear } from "../utils/forecast";

const { Text, Title } = Typography;

/* ------------------------------------------------------------------ Helfer */

const eur = (value: number) =>
  value.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " €";

const pct = (value: number) =>
  value.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " %";

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Eine Zelle der Plan-Matrix: Nominal und Zinssatz eines Jahres. */
export interface PlanCell {
  year: number;
  nominal: number;
  ratePp: number;
}

export interface PlanVariant {
  id: string;
  label: string;
  /** Anteil an der Aufteilung in Prozentpunkten (Eingabe). */
  sharePp: number;
  cells: PlanCell[];
}

interface EvaluatedVariant {
  variant: PlanVariant;
  interests: number[];
  total: number;
}

/**
 * Eine Zeile der Aufteilung: Gruppe mit Prozentanteil.
 * Das Nominal stammt ausschließlich aus den im jeweiligen Jahr ablaufenden
 * Veranlagungen (Fälligkeit = endDatum), verteilt nach dem Prozentanteil.
 */
interface SplitRow {
  id: string;
  label: string;
  /** Konfigurierter Anteil in Prozentpunkten. */
  sharePp: number;
  /** Anteiliges Nominal der im Jahr ablaufenden Veranlagungen. */
  nominals: number[];
  /** Zinsen je Plan-Jahr (Index entspricht dem Horizont). */
  interests: number[];
  totalNominal: number;
  totalInterest: number;
}

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

/** Zinsen eines Plan-Jahres: einfache Verzinsung, Stichtag wird anteilig berücksichtigt. */
function interestOfCell(cell: PlanCell, start: Dayjs): number {
  const yearStart = dayjs(`${cell.year}-01-01`);
  const from = yearStart.isBefore(start, "day") ? start : yearStart;
  const to = dayjs(`${cell.year}-12-31`);
  if (to.isBefore(from, "day") || cell.nominal <= 0) {
    return 0;
  }
  const entry: KontoData = {
    bankName: "Prognose",
    kontoNumber: "—",
    startDatum: from,
    endDatum: to,
    zinssatz: cell.ratePp,
    nominal: cell.nominal,
    dayCountConvention: "actual",
  };
  return calculateInterest(entry, from, to);
}

const makeCells = (years: number[], nominal: number, ratePp: number): PlanCell[] =>
  years.map((year) => ({ year, nominal, ratePp }));

/** Startverteilung: die Gruppen teilen sich die Anlagesumme zu gleichen Teilen. */
const equalSharePp = (count: number) => round2(100 / Math.max(count, 1));

/* ------------------------------------------------- Persistierter Zustand */

/** In `prognose.json` gespeicherter Zustand der Prognose. */
export interface ForecastState {
  version: 1;
  startDate: string;
  horizonYears: number;
  variants: PlanVariant[];
  savedAt: string;
}

/** Jahreswerte der Prognose – Grundlage für die ausgegrauten Historien-Zeilen. */
export interface ForecastYearAggregate {
  year: number;
  nominal: number;
  ratePp: number;
  interest: number;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Validiert eine aus `prognose.json` gelesene Struktur. */
export function parseForecastState(raw: unknown): ForecastState | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const candidate = raw as Partial<ForecastState>;
  if (!Array.isArray(candidate.variants) || candidate.variants.length === 0) {
    return null;
  }
  const variants: PlanVariant[] = candidate.variants.map((variant, index) => {
    const cells = Array.isArray(variant?.cells)
      ? variant.cells
          .filter(
            (cell) =>
              cell &&
              isFiniteNumber(cell.year) &&
              isFiniteNumber(cell.nominal) &&
              isFiniteNumber(cell.ratePp),
          )
          .map((cell) => ({
            year: cell.year,
            nominal: cell.nominal,
            ratePp: cell.ratePp,
          }))
      : [];
    return {
      id:
        typeof variant?.id === "string" && variant.id.trim()
          ? variant.id
          : `variante-${index + 1}`,
      label:
        typeof variant?.label === "string" && variant.label.trim()
          ? variant.label
          : `Variante ${index + 1}`,
      sharePp: isFiniteNumber(variant?.sharePp) ? variant.sharePp : 0,
      cells,
    };
  });
  const horizonYears = isFiniteNumber(candidate.horizonYears)
    ? Math.max(1, Math.min(Math.round(candidate.horizonYears), 20))
    : 5;
  return {
    version: 1,
    startDate:
      typeof candidate.startDate === "string"
        ? candidate.startDate
        : dayjs().format("YYYY-MM-DD"),
    horizonYears,
    variants,
    savedAt:
      typeof candidate.savedAt === "string"
        ? candidate.savedAt
        : dayjs().toISOString(),
  };
}

/**
 * Fasst die gespeicherte Prognose zu Jahreswerten zusammen.
 * Die Jahre werden – wie in der Ansicht – ab dem Referenzjahr gezählt.
 */
export function forecastYearAggregates(
  state: ForecastState | null | undefined,
  reference: Dayjs = dayjs().startOf("day"),
): ForecastYearAggregate[] {
  if (!state || !Array.isArray(state.variants) || state.variants.length === 0) {
    return [];
  }
  const horizon = Math.max(
    1,
    Math.min(Math.round(state.horizonYears) || 1, 20),
  );
  return Array.from({ length: horizon }, (_, index) => {
    const year = reference.year() + index;
    let nominal = 0;
    let interest = 0;
    let weightedRate = 0;
    state.variants.forEach((variant) => {
      const cell = variant.cells.find((item) => item.year === year);
      if (!cell || cell.nominal <= 0) {
        return;
      }
      nominal += cell.nominal;
      interest += interestOfCell(cell, reference);
      weightedRate += cell.nominal * cell.ratePp;
    });
    return {
      year,
      nominal: round2(nominal),
      ratePp: nominal > 0 ? round2(weightedRate / nominal) : 0,
      interest: round2(interest),
    };
  });
}

/* --------------------------------------------------------------- Komponente */

interface ForecastViewProps {
  accounts: KontoData[];
  onBack: () => void;
  /** Zuletzt gespeicherte Prognose (aus `prognose.json`). */
  initialForecast?: ForecastState | null;
  /** Wird bei jeder Änderung aufgerufen – der Aufrufer persistiert den Zustand. */
  onForecastChange?: (state: ForecastState) => void;
}

export default function ForecastView({
  accounts,
  onBack,
  initialForecast = null,
  onForecastChange,
}: ForecastViewProps) {
  const [startDate] = useState<Dayjs>(() => dayjs().startOf("day"));
  const [horizonYears, setHorizonYears] = useState(
    () => initialForecast?.horizonYears ?? 5,
  );
  const [variants, setVariants] = useState<PlanVariant[]>(
    () => initialForecast?.variants ?? [],
  );
  // Mit gespeicherter Prognose keine Startwerte überschreiben.
  const [edited, setEdited] = useState(
    () => Boolean(initialForecast?.variants.length),
  );

  const startYear = startDate.year();
  const years = useMemo(
    () => Array.from({ length: horizonYears }, (_, i) => startYear + i),
    [startYear, horizonYears],
  );

  const running = useMemo(
    () => accounts.filter((entry) => !dayjs(entry.endDatum).isBefore(startDate, "day")),
    [accounts, startDate],
  );
  const runningNominal = round2(running.reduce((sum, entry) => sum + entry.nominal, 0));
  const runningRate = round2(currentAverageRatePp(running));

  // Prognose-Nominale: nur Beträge, die im jeweiligen Jahr fällig werden.
  const expiringByYear = useMemo(
    () => expiringNominalByYear(accounts, startDate, years),
    [accounts, startDate, years],
  );

  // Startwerte: gleiches Nominal und gleicher Zinssatz für alle Jahre, abgeleitet aus dem Bestand.
  useEffect(() => {
    if (edited) {
      return;
    }
    const nominal = runningNominal > 0 ? runningNominal : 100000;
    const rate = runningRate > 0 ? runningRate : 2.5;
    setVariants([
      {
        id: "fix",
        label: "Variante 1 · Zins fix",
        sharePp: equalSharePp(2),
        cells: makeCells(years, nominal, rate),
      },
      {
        id: "variabel",
        label: "Variante 2 · Zins variabel",
        sharePp: equalSharePp(2),
        cells: makeCells(years, nominal, rate),
      },
    ]);
  }, [edited, runningNominal, runningRate, years]);

  // Zustand nach außen melden – der Aufrufer persistiert ihn in `prognose.json`.
  useEffect(() => {
    if (!onForecastChange || variants.length === 0) {
      return;
    }
    onForecastChange({
      version: 1,
      startDate: startDate.format("YYYY-MM-DD"),
      horizonYears,
      variants,
      savedAt: dayjs().toISOString(),
    });
  }, [onForecastChange, variants, horizonYears, startDate]);

  const changeHorizon = (value: number) => {
    setHorizonYears(value);
    const nextYears = Array.from({ length: value }, (_, i) => startYear + i);
    setVariants((prev) =>
      prev.map((variant) => {
        const cells = nextYears.map((year) => {
          const existing = variant.cells.find((cell) => cell.year === year);
          const fallback = variant.cells[variant.cells.length - 1];
          return (
            existing ?? {
              year,
              nominal: fallback?.nominal ?? 0,
              ratePp: fallback?.ratePp ?? 0,
            }
          );
        });
        return { ...variant, cells };
      }),
    );
  };

  const updateCell = (
    variantId: string,
    year: number,
    field: "nominal" | "ratePp",
    value: number,
  ) => {
    setEdited(true);
    setVariants((prev) =>
      prev.map((variant) =>
        variant.id === variantId
          ? {
              ...variant,
              cells: variant.cells.map((cell) =>
                cell.year === year ? { ...cell, [field]: value } : cell,
              ),
            }
          : variant,
      ),
    );
  };

  const addVariant = () => {
    setEdited(true);
    const template = variants[variants.length - 1];
    setVariants((prev) => {
      const count = prev.length + 1;
      const sharePp = equalSharePp(count);
      const factor = (100 - sharePp) / 100;
      return [
        ...prev.map((variant) => ({ ...variant, sharePp: round2(variant.sharePp * factor) })),
        {
          id: nextId("variante"),
          label: `Gruppe ${count}`,
          sharePp,
          cells: template
            ? template.cells.map((cell) => ({ ...cell }))
            : makeCells(years, 100000, 2.5),
        },
      ];
    });
  };

  const removeVariant = (variantId: string) => {
    setEdited(true);
    setVariants((prev) => {
      if (prev.length <= 1) {
        return prev;
      }
      const remaining = prev.filter((variant) => variant.id !== variantId);
      const sum = remaining.reduce((total, variant) => total + variant.sharePp, 0);
      if (sum <= 0) {
        return remaining.map((variant) => ({ ...variant, sharePp: equalSharePp(remaining.length) }));
      }
      return remaining.map((variant) => ({
        ...variant,
        sharePp: round2((variant.sharePp / sum) * 100),
      }));
    });
  };

  const renameVariant = (variantId: string, label: string) => {
    setEdited(true);
    setVariants((prev) =>
      prev.map((variant) => (variant.id === variantId ? { ...variant, label } : variant)),
    );
  };

  const evaluated = useMemo<EvaluatedVariant[]>(
    () =>
      variants.map((variant) => {
        const interests = variant.cells.map((cell) => interestOfCell(cell, startDate));
        return {
          variant,
          interests,
          total: round2(interests.reduce((sum, value) => sum + value, 0)),
        };
      }),
    [variants, startDate],
  );

  const yearTotals = useMemo(
    () =>
      years.map((_, index) =>
        round2(evaluated.reduce((sum, entry) => sum + (entry.interests[index] ?? 0), 0)),
      ),
    [evaluated, years],
  );

  const grandTotal = round2(yearTotals.reduce((sum, value) => sum + value, 0));

  /** Summe aller im Horizont ablaufenden Nominale – Grundlage der Aufteilung. */
  const expiringTotal = round2(expiringByYear.reduce((sum, value) => sum + value, 0));

  const splitSum = round2(variants.reduce((sum, variant) => sum + variant.sharePp, 0));

  const updateShare = (variantId: string, sharePp: number) => {
    setEdited(true);
    const value = Math.min(Math.max(sharePp, 0), 100);
    setVariants((prev) =>
      prev.map((variant) => (variant.id === variantId ? { ...variant, sharePp: value } : variant)),
    );
  };

  const splitRows = useMemo<SplitRow[]>(
    () =>
      variants.map((variant) => {
        // Nominal je Jahr = ablaufende Veranlagungen des Jahres × Prozentanteil.
        const nominals = years.map((_, index) =>
          round2(((expiringByYear[index] ?? 0) * variant.sharePp) / 100),
        );
        const interests = years.map((year, index) => {
          const nominal = nominals[index];
          const cell = variant.cells.find((item) => item.year === year);
          if (!cell || nominal <= 0) {
            return 0;
          }
          return round2(interestOfCell({ ...cell, nominal }, startDate));
        });
        const totalNominal = round2(nominals.reduce((sum, value) => sum + value, 0));
        const totalInterest = round2(interests.reduce((sum, value) => sum + value, 0));
        return {
          id: variant.id,
          label: variant.label,
          sharePp: variant.sharePp,
          nominals,
          interests,
          totalNominal,
          totalInterest,
        };
      }),
    [variants, expiringByYear, startDate, years],
  );

  const splitYearTotals = useMemo(
    () =>
      years.map((_, index) =>
        round2(splitRows.reduce((sum, row) => sum + (row.interests[index] ?? 0), 0)),
      ),
    [splitRows, years],
  );

  const splitYearNominals = useMemo(
    () =>
      years.map((_, index) =>
        round2(splitRows.reduce((sum, row) => sum + (row.nominals[index] ?? 0), 0)),
      ),
    [splitRows, years],
  );

  const splitTotal = round2(splitRows.reduce((sum, row) => sum + row.totalInterest, 0));
  const splitNominalTotal = round2(splitRows.reduce((sum, row) => sum + row.totalNominal, 0));

  const variantColumns: TableProps<PlanVariant>["columns"] = [
    {
      title: "Variante",
      key: "label",
      fixed: "left",
      width: 210,
      render: (_value, record) => (
        <Text
          strong
          editable={{ onChange: (value) => renameVariant(record.id, value) }}
          style={{ whiteSpace: "normal" }}
        >
          {record.label}
        </Text>
      ),
    },
    ...years.map((year, index) => ({
      title: (
        <Space direction="vertical" size={0} style={{ lineHeight: 1.2 }}>
          <span>{year}</span>
          <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
            Plan € / %
          </Text>
        </Space>
      ),
      key: String(year),
      width: 150,
      render: (_value: unknown, record: PlanVariant) => {
        const cell = record.cells.find((item) => item.year === year);
        if (!cell) {
          return null;
        }
        const interest = interestOfCell(cell, startDate);
        return (
          <div className="forecast-cell">
            <InputNumber
              size="small"
              controls={false}
              value={cell.nominal}
              min={0}
              step={1000}
              decimalSeparator=","
              addonAfter="€"
              style={{ width: "100%" }}
              onChange={(value) =>
                updateCell(record.id, year, "nominal", Number(value ?? 0))
              }
            />
            <InputNumber
              size="small"
              controls={false}
              value={cell.ratePp}
              min={-5}
              max={30}
              step={0.1}
              decimalSeparator=","
              addonAfter="%"
              style={{ width: "100%" }}
              onChange={(value) =>
                updateCell(record.id, year, "ratePp", Number(value ?? 0))
              }
            />
            <Text type="secondary" className="forecast-cell-interest">
              {eur(interest)}
            </Text>
          </div>
        );
      },
    })),
    {
      title: "Summe",
      key: "total",
      width: 120,
      align: "right",
      render: (_value, record) => {
        const entry = evaluated.find((item) => item.variant.id === record.id);
        return <Text strong>{eur(entry?.total ?? 0)}</Text>;
      },
    },
    {
      title: "",
      key: "actions",
      width: 48,
      render: (_value, record) => (
        <Tooltip title="Variante entfernen">
          <Button
            type="text"
            size="small"
            icon={<DeleteOutlined />}
            onClick={() => removeVariant(record.id)}
            disabled={variants.length <= 1}
            aria-label={`Variante ${record.label} entfernen`}
          />
        </Tooltip>
      ),
    },
  ];

  const splitColumns: TableProps<SplitRow>["columns"] = [
    {
      title: "Gruppe",
      key: "label",
      width: 210,
      render: (_value, record) => <Text strong>{record.label}</Text>,
    },
    {
      title: "Anteil",
      key: "share",
      width: 150,
      render: (_value, record) => (
        <InputNumber
          size="small"
          min={0}
          max={100}
          step={5}
          decimalSeparator=","
          addonAfter="%"
          value={record.sharePp}
          onChange={(value) => updateShare(record.id, Number(value ?? 0))}
          style={{ width: 122 }}
        />
      ),
    },
    ...years.map((year, index) => ({
      title: (
        <Space direction="vertical" size={0} style={{ lineHeight: 1.2 }}>
          <span>{year}</span>
          <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
            Nominal / Zinsen
          </Text>
        </Space>
      ),
      key: `year-${year}`,
      align: "right" as const,
      width: 150,
      render: (_value: unknown, record: SplitRow) => {
        const nominal = record.nominals[index] ?? 0;
        return (
          <div className="forecast-split-cell">
            <span className="forecast-split-amount forecast-split-nominal">
              {eur(nominal)}
            </span>
            <span className="forecast-split-amount forecast-split-interest">
              {eur(record.interests[index] ?? 0)}
            </span>
          </div>
        );
      },
    })),
    {
      title: "Summe Nominal",
      key: "nominal-total",
      align: "right",
      width: 140,
      render: (_value, record) => (
        <Text strong className="forecast-split-amount">
          {eur(record.totalNominal)}
        </Text>
      ),
    },
    {
      title: "Summe Zinsen",
      key: "interest-total",
      align: "right",
      width: 140,
      render: (_value, record) => (
        <Text strong className="forecast-split-amount">
          {eur(record.totalInterest)}
        </Text>
      ),
    },
  ];

  const runningColumns: TableProps<KontoData>["columns"] = [
    { title: "Bank", dataIndex: "bankName", key: "bankName" },
    { title: "Konto", dataIndex: "kontoNumber", key: "kontoNumber" },
    {
      title: "Laufzeit bis",
      key: "end",
      render: (_value, record) => dayjs(record.endDatum).format("DD.MM.YYYY"),
    },
    {
      title: "Zins",
      key: "rate",
      align: "right",
      render: (_value, record) => pct(record.zinssatz),
    },
    {
      title: "Nominal",
      key: "nominal",
      align: "right",
      render: (_value, record) => eur(record.nominal),
    },
  ];

  return (
    <div className="forecast-page">
      <div className="forecast-head">
        <Space align="center" size={12}>
          <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
            Zurück
          </Button>
          <div>
            <Title level={4} style={{ margin: 0 }}>
              Prognose
            </Title>
            <Text type="secondary">
              Stichtag {startDate.format("DD.MM.YYYY")} · Plan und Zinssätze je Jahr
              anpassbar
            </Text>
          </div>
        </Space>
        <Space align="center" size={8}>
          <Text type="secondary">Horizont</Text>
          <Segmented
            value={horizonYears}
            onChange={(value) => changeHorizon(Number(value))}
            options={[3, 5, 10].map((value) => ({ label: `${value} Jahre`, value }))}
          />
        </Space>
      </div>

      <div className="stat-grid">
        <Card className="stat-card">
          <Statistic title="Laufendes Nominal" value={runningNominal} precision={2} suffix="€" />
        </Card>
        <Card className="stat-card">
          <Statistic title="Ø-Zins laufend" value={runningRate} precision={2} suffix="%" />
        </Card>
        <Card className="stat-card forecast-stat-merged">
          <Statistic title="Zinsen gesamt" value={grandTotal} precision={2} suffix="€" />
          <div className="forecast-stat-rows">
            <div className="forecast-stat-row">
              <span className="forecast-stat-label">Summe oben · Plan je Jahr</span>
              <span className="forecast-stat-value">{eur(grandTotal)}</span>
            </div>
            <div className="forecast-stat-row">
              <span className="forecast-stat-label">Summe unten · Aufteilung nach Prozent</span>
              <span className="forecast-stat-value">{eur(splitTotal)}</span>
            </div>
            {Math.abs(splitTotal - grandTotal) < 0.01 ? (
              <Tag className="forecast-stat-tag" color="green">
                Summen stimmen überein
              </Tag>
            ) : (
              <>
                <Tag className="forecast-stat-tag">andere Bezugsbasis</Tag>
                <Text type="secondary" className="forecast-stat-hint">
                  Oben zählt das geplante Nominal jeder Variante in jedem Jahr, unten nur die im
                  Jahr ablaufenden Beträge × Prozentanteil. Beide Summen sind deshalb nur gleich,
                  wenn die Aufteilung exakt dem Plan entspricht.
                </Text>
              </>
            )}
          </div>
        </Card>
      </div>

      <Card
        className="table-card forecast-card"
        title="Plan und Zinssätze je Jahr"
        extra={
          <Button size="small" icon={<PlusOutlined />} onClick={addVariant}>
            Variante
          </Button>
        }
      >
        <Text type="secondary" className="forecast-hint">
          Jede Zelle enthält den geplanten Betrag („Plan“) und den Zinssatz („%“) für das
          jeweilige Jahr. Änderungen wirken sofort auf alle Jahreswerte.
        </Text>
        <Table<PlanVariant>
          className="forecast-matrix"
          dataSource={variants}
          columns={variantColumns}
          rowKey="id"
          pagination={false}
          size="small"
          bordered
          scroll={{ x: "max-content" }}
          summary={() => (
            <Table.Summary fixed>
              <Table.Summary.Row>
                <Table.Summary.Cell index={0}>
                  <Text strong>Summe Zinsen</Text>
                </Table.Summary.Cell>
                {years.map((year, index) => (
                  <Table.Summary.Cell key={year} index={index + 1}>
                    <Text strong>{eur(yearTotals[index] ?? 0)}</Text>
                  </Table.Summary.Cell>
                ))}
                <Table.Summary.Cell index={years.length + 1} align="right">
                  <Text strong>{eur(grandTotal)}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={years.length + 2}>{null}</Table.Summary.Cell>
              </Table.Summary.Row>
            </Table.Summary>
          )}
        />
      </Card>

      <Card
        className="table-card forecast-card"
        title="Aufteilung nach Prozent"
        extra={
          <Tooltip title="Nur tatsächlich ablaufende Veranlagungen (Fälligkeit = Laufzeit bis) werden als Prognose-Nominal übernommen und nach den Prozentanteilen auf die Gruppen verteilt. Jahre ohne Fälligkeit bleiben bei 0 €.">
            <InfoCircleOutlined />
          </Tooltip>
        }
      >
        <Text type="secondary" className="forecast-hint">
          Nur die Prozentwerte sind Eingaben: Das Prognose-Nominal je Gruppe und Jahr ergibt
          sich ausschließlich aus den im jeweiligen Jahr ablaufenden Veranlagungen – im
          Horizont insgesamt {eur(expiringTotal)} –, verteilt nach dem Anteil. Jahre ohne
          Fälligkeit bleiben bei 0 €. Die Summe der Anteile sollte 100 % betragen.
        </Text>
        <div className="forecast-split-controls">
          <Tag color={Math.abs(splitSum - 100) < 0.01 ? "green" : "orange"}>
            Summe Anteile: {pct(splitSum)}
          </Tag>
        </div>
        {Math.abs(splitSum - 100) >= 0.01 && (
          <Alert
            type="warning"
            showIcon
            className="forecast-split-alert"
            message={`Die Anteile ergeben ${pct(splitSum)} statt 100 %. Die Nominalbeträge werden trotzdem aus den eingegebenen Prozentwerten berechnet.`}
          />
        )}

        <Table<SplitRow>
          className="forecast-split-table"
          dataSource={splitRows}
          columns={splitColumns}
          rowKey="id"
          pagination={false}
          size="small"
          bordered
          scroll={{ x: "max-content" }}
          summary={() => (
            <Table.Summary fixed>
            <Table.Summary.Row>
              <Table.Summary.Cell index={0}>
                <Text strong>Gesamt</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={1}>
                <Text strong>{pct(splitSum)}</Text>
              </Table.Summary.Cell>
              {years.map((year, index) => (
                <Table.Summary.Cell key={`year-${year}`} index={index + 2} align="right">
                  <span className="forecast-split-amount forecast-split-nominal">
                    {eur(splitYearNominals[index] ?? 0)}
                  </span>
                </Table.Summary.Cell>
              ))}
              <Table.Summary.Cell index={years.length + 2} align="right">
                <Text strong className="forecast-split-amount">
                  {eur(splitNominalTotal)}
                </Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={years.length + 3} align="right">
                <Text strong className="forecast-split-amount">
                  {eur(splitTotal)}
                </Text>
              </Table.Summary.Cell>
            </Table.Summary.Row>
            <Table.Summary.Row className="forecast-split-year-row">
              <Table.Summary.Cell index={0} colSpan={2}>
                <Text strong>Gesamtzinsen pro Jahr</Text>
              </Table.Summary.Cell>
              {years.map((year, index) => (
                <Table.Summary.Cell key={`interest-${year}`} index={index + 2} align="right">
                  <span className="forecast-split-amount forecast-split-interest">
                    {eur(splitYearTotals[index] ?? 0)}
                  </span>
                </Table.Summary.Cell>
              ))}
              <Table.Summary.Cell index={years.length + 2}>{null}</Table.Summary.Cell>
              <Table.Summary.Cell index={years.length + 3} align="right">
                <Text strong className="forecast-split-amount">
                  {eur(splitTotal)}
                </Text>
              </Table.Summary.Cell>
            </Table.Summary.Row>
            </Table.Summary>
          )}
        />
      </Card>

      <Card className="table-card forecast-card" title="Laufende Veranlagungen">
        {running.length === 0 ? (
          <Text type="secondary">Keine laufenden Veranlagungen zum Stichtag.</Text>
        ) : (
          <Table<KontoData>
            dataSource={running}
            columns={runningColumns}
            rowKey={(record) => `${record.bankName}-${record.kontoNumber}`}
            pagination={false}
            size="small"
          />
        )}
      </Card>

      <Text type="secondary" className="forecast-disclaimer">
        Alle Werte sind annahmenbasiert und nicht garantiert. Gerechnet wird mit einfacher
        Verzinsung ohne Kapitalisierung; Wiederanlagen erfolgen zum jeweils angegebenen
        Zinssatz über die gewählte Laufzeit.
      </Text>
    </div>
  );
}

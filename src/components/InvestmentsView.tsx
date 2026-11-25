import {
  ArrowLeftOutlined,
  FileOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from "@ant-design/icons";
import { Button, Empty, Slider, Space, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { Dayjs } from "dayjs";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface Investment {
  bankName: string;
  kontoNumber: string;
  startDatum: Dayjs;
  endDatum: Dayjs;
  nominal: number;
  zinssatz: number;
  effektivzinssatz?: number | null;
  dayCountConvention?: string;
}

type InvestmentRow =
  | { key: string; kind: "account"; account: Investment }
  | { key: string; kind: "total"; groupName: string; total: number };

interface Group {
  name: string;
  banks: string[];
}

export function investmentSections(accounts: Investment[], groups: Group[], today: Dayjs) {
  const active = accounts.filter((account) =>
    account.startDatum.isValid() && account.endDatum.isValid() &&
    !account.startDatum.isAfter(today, "day") && !account.endDatum.isBefore(today, "day"),
  );
  const ordered = (items: Investment[]) => [...items].sort((a, b) =>
    a.endDatum.valueOf() - b.endDatum.valueOf() || a.bankName.localeCompare(b.bankName, "de"),
  );
  return [
    ...groups.map((group) => ({ name: group.name, accounts: ordered(active.filter((account) => group.banks.includes(account.bankName))) })),
    { name: "Nicht zugeordnet", accounts: ordered(active.filter((account) => !groups.some((group) => group.banks.includes(account.bankName)))) },
  ].filter((section) => section.accounts.length > 0);
}

export function investmentRows(sections: ReturnType<typeof investmentSections>): InvestmentRow[] {
  return sections.flatMap((section, sectionIndex) => [
    ...section.accounts.map((account, index): InvestmentRow => ({ key: `${sectionIndex}-${account.bankName}-${account.kontoNumber}-${index}`, kind: "account", account })),
    { key: `total-${sectionIndex}`, kind: "total", groupName: section.name, total: section.accounts.reduce((sum, account) => sum + account.nominal, 0) } as InvestmentRow,
  ]);
}

/** Each account counts once, even when it is listed in several groups. */
export function investmentGrandTotal(sections: ReturnType<typeof investmentSections>) {
  const unique = new Set(sections.flatMap((section) => section.accounts));
  let total = 0;
  unique.forEach((account) => { total += account.nominal; });
  return { count: unique.size, total };
}

export interface SheetLayout { columns: number[][]; columnWidth: number; scale: number }

/**
 * Distributes the group tables over 1..maxColumns columns (keeping reading order,
 * filling the shortest column) and picks the column count that lets the tables be
 * shown largest while still fitting the available page area.
 */
export function sheetLayout(
  sizes: { width: number; height: number }[],
  area: { width: number; height: number },
  gap = 16,
  maxColumns = 4,
  maxScale = 1.25,
): SheetLayout | null {
  if (!sizes.length || area.width <= 0 || area.height <= 0) return null;
  const columnWidth = Math.max(...sizes.map((size) => size.width));
  let best: SheetLayout | null = null;
  for (let count = 1; count <= Math.min(maxColumns, sizes.length); count++) {
    const columns: number[][] = Array.from({ length: count }, () => []);
    const heights = Array(count).fill(0);
    // Sequential split keeps groups in reading order (top-to-bottom, then next column).
    let remaining = sizes.reduce((sum, size) => sum + size.height + gap, 0);
    let column = 0;
    sizes.forEach((size, index) => {
      const item = size.height + gap;
      const target = (remaining + heights[column]) / (count - column);
      if (column < count - 1 && heights[column] > 0 && heights[column] + item / 2 > target) column++;
      columns[column].push(index);
      heights[column] += item;
      remaining -= item;
    });
    const filled = columns.filter((items) => items.length > 0);
    const width = filled.length * columnWidth + (filled.length - 1) * gap;
    const height = Math.max(...heights) - gap;
    const scale = Math.min(area.width / width, area.height / height, maxScale);
    if (!best || scale > best.scale + 0.001) best = { columns: filled, columnWidth, scale };
  }
  return best;
}

function withoutWidths<T>(columns: ColumnsType<T>): ColumnsType<T> {
  return columns.map((column) => {
    const { width: _width, ...rest } = column;
    return "children" in column && column.children
      ? { ...rest, children: withoutWidths(column.children) } as ColumnsType<T>[number]
      : rest as ColumnsType<T>[number];
  });
}

// A4 landscape at 96 dpi (297 × 210 mm) and the gap between tables on the sheet.
const A4_WIDTH = 1123;
const A4_HEIGHT = 794;
const SHEET_GAP = 16;

export function investmentDuration(start: Dayjs, end: Dayjs) {
  const months = end.diff(start, "month");
  return start.add(months, "month").isSame(end, "day") ? `${months} Mo` : `${end.diff(start, "day")} Tage`;
}

export default function InvestmentsView({ accounts, groups, onBack }: {
  accounts: Investment[];
  groups: Group[];
  onBack: () => void;
}) {
  const today = dayjs().startOf("day");
  const sections = investmentSections(accounts, groups, today);
  const euro = new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" });
  const rate = new Intl.NumberFormat("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const [scale, setScale] = useState(100);
  const [fullscreen, setFullscreen] = useState(false);
  const [pageMode, setPageMode] = useState(true);
  const [layout, setLayout] = useState<SheetLayout | null>(null);
  const [preview, setPreview] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const grand = investmentGrandTotal(sections);
  const sectionsKey = JSON.stringify(sections.map((section) => [section.name, section.accounts.length]));

  // Fit the A4 sheet into the visible area of the view.
  useLayoutEffect(() => {
    if (!pageMode) return;
    const outer = scrollRef.current;
    if (!outer) return;
    const update = () => {
      const inset = fullscreen ? 76 : 32;
      const next = Math.min((outer.clientWidth - 32) / A4_WIDTH, (outer.clientHeight - inset) / A4_HEIGHT);
      setPreview(Math.max(0.2, next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(outer);
    return () => observer.disconnect();
  }, [pageMode, fullscreen]);

  // Measure every group table at its natural size and choose how many go side by side.
  useLayoutEffect(() => {
    if (!pageMode) return;
    const measure = measureRef.current;
    const area = areaRef.current;
    if (!measure || !area) return;
    const sizes = Array.from(measure.children).map((child) => {
      const rect = (child as HTMLElement).getBoundingClientRect();
      return { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
    });
    // Leave a small safety margin for sub-pixel rounding of zoomed table rows.
    setLayout(sheetLayout(sizes, { width: area.clientWidth * 0.98, height: area.clientHeight * 0.97 }, SHEET_GAP));
  }, [pageMode, sectionsKey]);

  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [fullscreen]);

  const columnsFor = (section: { name: string; accounts: Investment[] }): ColumnsType<InvestmentRow> => [
    { title: "Bank", dataIndex: "bank", key: "bank", width: "24%",
      onHeaderCell: () => ({ className: "investments-bank-th" }),
      render: (_, row) => row.kind === "total" ? <strong>Summe</strong> : row.account.bankName },
    {
      key: `group-${section.name}`,
      onHeaderCell: () => ({ className: "investments-group-th" }),
      title: (
        <span className="investments-group-band">
          <span className="investments-group-title">{section.name}</span>
          <span className="investments-group-count">
            {section.accounts.length} {section.accounts.length === 1 ? "Anlage" : "Anlagen"}
          </span>
        </span>
      ),
      children: [
        { title: "EUR", key: "nominal", align: "right", width: "16%",
          render: (_, row) => row.kind === "total" ? <strong>{euro.format(row.total)}</strong> : euro.format(row.account.nominal) },
        { title: "Laufzeit", key: "dates", align: "center", width: "26%",
          render: (_, row) => row.kind === "account" ? (
            <span className="investments-dates">
              {row.account.startDatum.format("DD.MM.YYYY")} – {row.account.endDatum.format("DD.MM.YYYY")}
              <span className="investments-duration">{investmentDuration(row.account.startDatum, row.account.endDatum)}</span>
            </span>
          ) : null },
        { title: "Zinssatz", key: "rate", align: "right", width: "17%",
          render: (_, row) => row.kind === "account" ? `${rate.format(row.account.zinssatz)} %` : null },
        { title: "Effektivzinssatz", key: "effective", align: "right", width: "17%",
          render: (_, row) => row.kind === "account" ? `${rate.format(row.account.effektivzinssatz ?? row.account.zinssatz)} %` : null },
      ],
    },
  ];

  const fitToWidth = () => {
    const outer = scrollRef.current;
    const inner = contentRef.current;
    if (!outer || !inner) return;
    const tables = Array.from(inner.querySelectorAll("table")) as HTMLElement[];
    const factor = scale / 100;
    const natural = tables.reduce((max, table) => Math.max(max, table.scrollWidth / factor), 0);
    const available = outer.clientWidth - 32;
    if (!natural || available <= 0) return;
    const next = Math.floor((available / natural) * 100 / 10) * 10;
    setScale(Math.min(200, Math.max(50, next)));
  };

  // On the A4 sheet columns size to their content: fixed percentages would inflate the
  // natural table width and force the whole page to be scaled down.
  const renderTable = (section: { name: string; accounts: Investment[] }, compact = false) => (
    <Table<InvestmentRow>
      className={compact ? "table investments-table investments-table-compact" : "table investments-table"}
      rowHoverable={false}
      dataSource={investmentRows([section])}
      columns={compact ? withoutWidths(columnsFor(section)) : columnsFor(section)}
      rowKey="key"
      pagination={false}
      size={compact ? "small" : "middle"}
      bordered
      locale={{ emptyText: "Keine laufenden Veranlagungen vorhanden" }}
      rowClassName={(row) => row.kind === "total" ? "investments-total" : ""}
    />
  );

  const grandTotalBar = (
    <div className="investments-grand-total" role="status">
      <span className="investments-grand-total-label">Gesamtsumme</span>
      <span className="investments-grand-total-count">
        {grand.count} {grand.count === 1 ? "Anlage" : "Anlagen"}
      </span>
      <span className="investments-grand-total-value">{euro.format(grand.total)}</span>
    </div>
  );

  const pageToggle = (
    <Button
      size="small"
      icon={<FileOutlined />}
      type={pageMode ? "primary" : "default"}
      onClick={() => setPageMode((value) => !value)}
      aria-pressed={pageMode}
    >
      A4 quer
    </Button>
  );

  const fullscreenButton = (
    <Button
      size="small"
      icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
      onClick={() => setFullscreen((value) => !value)}
      aria-pressed={fullscreen}
      aria-label={fullscreen ? "Vollbild beenden" : "Vollbild"}
      title={fullscreen ? "Vollbild beenden" : "Vollbild"}
    />
  );

  const scaleControl = pageMode ? (
    <Space className="investments-scale-control" size={8}>
      {layout ? (
        <Typography.Text type="secondary">
          {layout.columns.length} {layout.columns.length === 1 ? "Spalte" : "Spalten"} · Tabellen {Math.round(layout.scale * 100)} %
        </Typography.Text>
      ) : null}
      {pageToggle}
      {fullscreenButton}
    </Space>
  ) : (
    <Space className="investments-scale-control" size={8}>
      {pageToggle}
      <Typography.Text type="secondary">Skalierung</Typography.Text>
      <ZoomOutOutlined />
      <Slider
        min={50}
        max={200}
        step={10}
        value={scale}
        onChange={setScale}
        ariaLabelForHandle="Skalierung der Tabelle"
        tooltip={{ formatter: (value) => `${value} %` }}
        style={{ width: 150, margin: 0 }}
      />
      <ZoomInOutlined />
      <Typography.Text style={{ width: 48, textAlign: "right" }}>{scale} %</Typography.Text>
      <Button size="small" onClick={fitToWidth}>An Breite anpassen</Button>
      <Button size="small" type="link" onClick={() => setScale(100)} disabled={scale === 100}>
        Zurücksetzen
      </Button>
      {fullscreenButton}
    </Space>
  );

  const sheet = (
    <>
      <div className="investments-measure" ref={measureRef} aria-hidden="true">
        {sections.map((section) => (
          <section className="investments-group" key={section.name}>{renderTable(section, true)}</section>
        ))}
      </div>
      <div className="investments-sheet-frame" style={{ width: A4_WIDTH * preview, height: A4_HEIGHT * preview }}>
        <div className="investments-sheet" style={{ width: A4_WIDTH, height: A4_HEIGHT, transform: `scale(${preview})` }}>
          <header className="investments-sheet-header">
            <span className="investments-sheet-title">Laufende Veranlagungen</span>
            <span>Stand {today.format("DD.MM.YYYY")}</span>
          </header>
          <div className="investments-sheet-area" ref={areaRef}>
            {layout ? (
              <div className="investments-sheet-columns" style={{ zoom: layout.scale, gap: SHEET_GAP }}>
                {layout.columns.map((column, index) => (
                  <div className="investments-sheet-column" key={index} style={{ width: layout.columnWidth, gap: SHEET_GAP }}>
                    {column.map((sectionIndex) => (
                      <section className="investments-group" key={sections[sectionIndex].name}>
                        {renderTable(sections[sectionIndex], true)}
                      </section>
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          {grandTotalBar}
        </div>
      </div>
    </>
  );

  return (
    <div className="investments-view">
      <div className="investments-toolbar">
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>Zurück</Button>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>Laufende Veranlagungen</Typography.Title>
          <Typography.Text type="secondary">Stand {today.format("DD.MM.YYYY")}</Typography.Text>
        </div>
        {fullscreen ? null : scaleControl}
      </div>
      <div
        className={fullscreen ? "investments-scroll investments-scroll-fullscreen" : "investments-scroll"}
        role="region"
        ref={scrollRef}
        aria-label="Laufende Veranlagungen nach Gruppen"
      >
        {fullscreen ? <div className="investments-fullscreen-bar">{scaleControl}</div> : null}
        {sections.length === 0 ? (
          <Empty description="Keine laufenden Veranlagungen vorhanden" />
        ) : pageMode ? sheet : (
          <div className="investments-scale" ref={contentRef} style={{ zoom: scale / 100 }}>
            {sections.map((section) => (
              <section className="investments-group" key={section.name}>{renderTable(section)}</section>
            ))}
            {grandTotalBar}
          </div>
        )}
      </div>
    </div>
  );
}

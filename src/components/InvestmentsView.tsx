import { ArrowLeftOutlined, ZoomInOutlined, ZoomOutOutlined } from "@ant-design/icons";
import { Button, Card, Empty, Slider, Space, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { Dayjs } from "dayjs";
import { useRef, useState } from "react";

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const columns: ColumnsType<InvestmentRow> = [
    { title: "Bank", dataIndex: "bank", key: "bank", width: 220,
      render: (_, row) => row.kind === "total" ? <strong>Summe</strong> : row.account.bankName },
    { title: "EUR", key: "nominal", align: "right", width: 170,
      render: (_, row) => row.kind === "total" ? <strong>{euro.format(row.total)}</strong> : euro.format(row.account.nominal) },
    { title: "Laufzeit", key: "dates", align: "center", width: 270,
      render: (_, row) => row.kind === "account" ? (
        <span className="investments-dates">
          {row.account.startDatum.format("DD.MM.YYYY")} – {row.account.endDatum.format("DD.MM.YYYY")}
          <span className="investments-duration">{investmentDuration(row.account.startDatum, row.account.endDatum)}</span>
        </span>
      ) : null },
    { title: "Zinssatz", key: "rate", align: "right", width: 130,
      render: (_, row) => row.kind === "account" ? `${rate.format(row.account.zinssatz)} %` : null },
    { title: "Effektivzinssatz", key: "effective", align: "right", width: 160,
      render: (_, row) => row.kind === "account" ? `${rate.format(row.account.effektivzinssatz ?? row.account.zinssatz)} %` : null },
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

  return (
    <div className="investments-view">
      <div className="investments-toolbar">
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>Zurück</Button>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>Laufende Veranlagungen</Typography.Title>
          <Typography.Text type="secondary">Stand {today.format("DD.MM.YYYY")}</Typography.Text>
        </div>
        <Space className="investments-scale-control" size={8}>
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
        </Space>
      </div>
      <div
        className="investments-scroll"
        role="region"
        ref={scrollRef}
        aria-label="Laufende Veranlagungen nach Gruppen"
      >
        {sections.length === 0 ? (
          <Empty description="Keine laufenden Veranlagungen vorhanden" />
        ) : (
          <div className="investments-scale" ref={contentRef} style={{ zoom: scale / 100 }}>
            {sections.map((section) => (
              <Card
                className="investments-group-card"
                key={section.name}
                title={<span className="investments-group-title">{section.name}</span>}
                extra={<span className="investments-group-count">
                  {section.accounts.length} {section.accounts.length === 1 ? "Anlage" : "Anlagen"}
                </span>}
              >
                <Table<InvestmentRow>
                  className="table investments-table"
                  rowHoverable={false}
                  dataSource={investmentRows([section])}
                  columns={columns}
                  rowKey="key"
                  pagination={false}
                  size="middle"
                  bordered
                  scroll={{ x: "max-content" }}
                  locale={{ emptyText: "Keine laufenden Veranlagungen vorhanden" }}
                  rowClassName={(row) => row.kind === "total" ? "investments-total" : ""}
                />
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import { ArrowLeftOutlined, TableOutlined } from "@ant-design/icons";
import { Button, Card, Space, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { Dayjs } from "dayjs";

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

  const rows = investmentRows(sections);
  const columns: ColumnsType<InvestmentRow> = [
    {
      title: "Bank", key: "bank", width: 150,
      render: (_, row) => row.kind === "total" ? <strong>Summe {row.groupName}</strong> : row.account.bankName,
    },
    {
      title: "Festgeld", children: [
        { title: "EUR", key: "nominal", align: "right", width: 170,
          render: (_, row) => row.kind === "total" ? <strong>{euro.format(row.total)}</strong> : euro.format(row.account.nominal) },
        { title: "Laufzeit", key: "dates", align: "center", width: 180,
          onHeaderCell: () => ({ colSpan: 2 }),
          render: (_, row) => row.kind === "account" ? <>{row.account.startDatum.format("DD.MM.YYYY")} bis<br />{row.account.endDatum.format("DD.MM.YYYY")}</> : null },
        { title: "", key: "duration", align: "center", width: 100,
          onHeaderCell: () => ({ colSpan: 0 }),
          render: (_, row) => row.kind === "account" ? investmentDuration(row.account.startDatum, row.account.endDatum) : null },
        { title: "Zinssatz", key: "rate", align: "right", width: 140,
          render: (_, row) => row.kind === "account" ? `${rate.format(row.account.zinssatz)} % p.a.` : null },
        { title: "Effektivzinssatz", key: "effective", align: "right", width: 150,
          render: (_, row) => row.kind === "account" ? `${rate.format(row.account.effektivzinssatz ?? row.account.zinssatz)} % p.a.` : null },
      ],
    },
  ];

  return (
    <div className="investments-view">
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>Zurück</Button>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>Laufende Veranlagungen</Typography.Title>
          <Typography.Text type="secondary">Stand {today.format("DD.MM.YYYY")}</Typography.Text>
        </div>
      </div>
      <Card className="investments-card" title={<Space><TableOutlined /><span>Festgeldübersicht</span></Space>}>
        <div role="region" aria-label="Festgeldübersicht">
          <Table<InvestmentRow>
            className="table investments-table"
            rowHoverable={false}
            dataSource={rows}
            columns={columns}
            rowKey="key"
            pagination={false}
            size="middle"
            bordered
            scroll={{ x: "max-content" }}
            locale={{ emptyText: "Keine laufenden Veranlagungen vorhanden" }}
            rowClassName={(row) => row.kind === "total" ? "investments-total" : ""}
          />
        </div>
      </Card>
    </div>
  );
}

import React, { useEffect, useState } from "react";
import dayjs, { Dayjs } from "dayjs";
import {
  Button,
  Card,
  DatePicker,
  FloatButton,
  Form,
  Input,
  InputNumber,
  Layout,
  Popconfirm,
  Row,
  Table,
  theme,
  Tooltip,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  MoonOutlined,
  SettingOutlined,
  SunOutlined,
} from "@ant-design/icons";
import { RangePickerProps } from "antd/lib/date-picker";

interface KontoData {
  bankName: string;
  kontoNumber: string;
  startDatum: Dayjs;
  endDatum: Dayjs;
  zinssatz: number;
  nominal: number;
  zinsen?: number;
  kommulierteZinsen?: number;
  quarterlyZinsen?: number;
  verbuchteRueckstellung?: number;
  kommulierteSumme?: number;
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
            })),
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
    // Using the range picker value, where values.dateRange is an array of two Dayjs objects
    const [startDatum, endDatum] = values.dateRange;
    const { bankName, kontoNumber, zinssatz, nominal } = values;
    const newKonto: KontoData = {
      bankName,
      kontoNumber,
      startDatum,
      endDatum,
      zinssatz: parseFloat(zinssatz),
      kommulierteZinsen: 0,
      nominal: parseFloat(nominal),
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

  const calculateInterest = (
    entry: KontoData,
    startDatum: Dayjs,
    endDatum: Dayjs,
  ) => {
    const days = endDatum.diff(startDatum, "day");
    const interest = entry.nominal * (entry.zinssatz / 100) * (days / 365);
    return Math.round(interest * 100) / 100;
  };

  const calculateTotalInterest = () => {
    if (!data) return 0;
    const total = data.reduce((total, entry) => {
      return total + calculateInterest(entry, entry.startDatum, entry.endDatum);
    }, 0);
    return Math.round(total * 100) / 100;
  };

  const calculateSingleInterest = (entry: KontoData) => {
    return calculateInterest(entry, entry.startDatum, entry.endDatum);
  };

  const calculateQuarterlyTotalInterest = () => {
    if (!data) return 0;
    if (!quartalsBeginn || !quartalsEnde) return 0;

    const total = data.reduce((total, entry) => {
      return total + calculateQuarterlySingleInterest(entry);
    }, 0);
    return Math.round(total * 100) / 100;
  };

  const calculateQuarterlySingleInterest = (entry: KontoData) => {
    if (!quartalsBeginn || !quartalsEnde) return 0;
    if (quartalsEnde.isBefore(entry.startDatum)) return 0;
    if (quartalsBeginn.isBefore(entry.startDatum)) {
      return calculateInterest(entry, entry.startDatum, quartalsEnde);
    }
    return calculateInterest(entry, quartalsBeginn, quartalsEnde);
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
    return calculateInterest(entry, entry.startDatum, quartalsEnde);
  };

  const handlePrint = () => {
    if (!data) return;
    const now = dayjs(); // aktuelles Datum

    // Split data into active and expired accounts
    const activeData = data.filter(
      (entry) => !entry.endDatum.isBefore(now, "day"),
    );
    const expiredData = data.filter((entry) =>
      entry.endDatum.isBefore(now, "day"),
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
          <!-- Group header with bank name -->
          <tr class="group-header">
            <td colspan="11" class="bank-title">${bankName}</td>
          </tr>
          ${groupRows}
          <!-- Group totals -->
          <tr style="font-weight: bold;">
            <td>Summe</td>
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
    const expiredTableContent = buildTableContent(expiredData);

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
    const expiredTotalNominal = expiredData.reduce(
      (sum, entry) => sum + entry.nominal,
      0,
    );
    const expiredTotalSingleInterest = expiredData.reduce(
      (sum, entry) => sum + calculateSingleInterest(entry),
      0,
    );
    const expiredTotalAccumulated = expiredData.reduce(
      (sum, entry) => sum + calculateAccumulatedInterest(entry),
      0,
    );
    const expiredTotalQuarterly = expiredData.reduce(
      (sum, entry) => sum + calculateQuarterlySingleInterest(entry),
      0,
    );
    const expiredTotalPaid = expiredData.reduce(
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
          <th>Konto Nummer</th>
          <th>Startdatum</th>
          <th>Enddatum</th>
          <th>Lfz. Mon.</th>
          <th>Zins<br/>satz (%)</th>
          <th>Nominal (€)</th>
          <th>Zinsen gesamte Laufzeit (€)</th>
          <th>Kommulierte Zinsen bis Stichtag (€)</th>
          <th>Zu buchende Quartalszinsen (€)</th>
          <th>Bezahlte Zinsen (€)</th>
          <th>Rückstellung (€)</th>
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
          <th>Zins<br/>satz (%)</th>
          <th>Nominal (€)</th>
          <th>Zinsen gesamte Laufzeit (€)</th>
          <th>Kommulierte Zinsen bis Stichtag (€)</th>
          <th>Zu buchende Quartalszinsen (€)</th>
          <th>Bezahlte Zinsen (€)</th>
          <th>Rückstellung (€)</th>
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
        </style>
      </head>
      <body>
        <h1>Konten Übersicht</h1>
        ${
          quartalsBeginn && quartalsEnde
            ? `<p>Quartalsbeginn: ${quartalsBeginn.format("DD.MM.YYYY")}, Quartalsende: ${quartalsEnde.format("DD.MM.YYYY")}</p>`
            : ""
        }
        <h2>Aktive Konten</h2>
        ${activeTableHTML}
        <div class="summary">
          <h2>Aktive Konten Zusammenfassung</h2>
          <table>
            <tr>
              <td>Gesamtsumme der Nominalwerte:</td>
              <td>${activeTotalNominal.toLocaleString("de-DE", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} €</td>
            </tr>
            <tr>
              <td>Gesamtsumme der Zinsen gesamte Laufzeit:</td>
              <td>${activeTotalSingleInterest.toLocaleString("de-DE", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} €</td>
            </tr>
            <tr>
              <td>Gesamtsumme der kummulierten Zinsen bis Stichtag:</td>
              <td>${activeTotalAccumulated.toLocaleString("de-DE", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} €</td>
            </tr>
            <tr>
              <td>Gesamtsumme der Quartalszinsen:</td>
              <td>${activeTotalQuarterly.toLocaleString("de-DE", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} €</td>
            </tr>
            <tr>
              <td>Gesamtsumme der Bezahlten Zinsen:</td>
              <td>${activeTotalPaid.toLocaleString("de-DE", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} €</td>
            </tr>
            <tr>
              <td>Gesamtsumme der Rückstellungen:</td>
              <td>${activeTotalReserve.toLocaleString("de-DE", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} €</td>
            </tr>
          </table>
        </div>

        <h2>Abgelaufene Konten</h2>
        ${expiredTableHTML}
        <div class="summary">
          <h2>Abgelaufene Konten Zusammenfassung</h2>
          <table>
            <tr>
              <td>Gesamtsumme der Nominalwerte:</td>
              <td>${expiredTotalNominal.toLocaleString("de-DE", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} €</td>
            </tr>
            <tr>
              <td>Gesamtsumme der Zinsen gesamte Laufzeit:</td>
              <td>${expiredTotalSingleInterest.toLocaleString("de-DE", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} €</td>
            </tr>
            <tr>
              <td>Gesamtsumme der kummulierten Zinsen bis Stichtag:</td>
              <td>${expiredTotalAccumulated.toLocaleString("de-DE", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} €</td>
            </tr>
            <tr>
              <td>Gesamtsumme der Quartalszinsen:</td>
              <td>${expiredTotalQuarterly.toLocaleString("de-DE", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} €</td>
            </tr>
            <tr>
              <td>Gesamtsumme der Bezahlten Zinsen:</td>
              <td>${expiredTotalPaid.toLocaleString("de-DE", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} €</td>
            </tr>
            <tr>
              <td>Gesamtsumme der Rückstellungen:</td>
              <td>${expiredTotalReserve.toLocaleString("de-DE", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} €</td>
            </tr>
          </table>
        </div>

        <div class="summary">
          <h2>Alle Konten Zusammenfassung</h2>
          <table>
            <tr>
              <td>Gesamtsumme der Nominalwerte:</td>
              <td>${allTotalNominal.toLocaleString("de-DE", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} €</td>
            </tr>
            <tr>
              <td>Gesamtsumme der Zinsen gesamte Laufzeit:</td>
              <td>${allTotalSingleInterest.toLocaleString("de-DE", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} €</td>
            </tr>
            <tr>
              <td>Gesamtsumme der kummulierten Zinsen bis Stichtag:</td>
              <td>${allTotalAccumulated.toLocaleString("de-DE", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} €</td>
            </tr>
            <tr>
              <td>Gesamtsumme der Quartalszinsen:</td>
              <td>${allTotalQuarterly.toLocaleString("de-DE", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} €</td>
            </tr>
            <tr>
              <td>Gesamtsumme der Bezahlten Zinsen:</td>
              <td>${allTotalPaid.toLocaleString("de-DE", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} €</td>
            </tr>
            <tr>
              <td>Gesamtsumme der Rückstellungen:</td>
              <td>${allTotalReserve.toLocaleString("de-DE", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} €</td>
            </tr>
          </table>
        </div>
      </body>
    </html>
  `;

    window.ipcRenderer.send("create-print-window", { content: contentHTML });
  };

  return (
    <Layout className="layout">
      <div style={{ minWidth: 300, width: "100%", flex: 1 }}>
        <Card style={{ margin: 15 }}>
          <Form form={form} layout="vertical" onFinish={handleAddKonto}>
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
              <Input type="number" />
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
              <Input type="number" />
            </Form.Item>
            <Button type="primary" htmlType="submit">
              Hinzufügen
            </Button>
          </Form>
        </Card>
      </div>
      <div style={{ minWidth: 300, width: "100%", flex: 3 }}>
        <Card style={{ margin: "15px 15px 15px 0" }}>
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

        <Card style={{ margin: "15px 15px 15px 0" }}>
          <Typography.Text>
            Gesamtzinsen: {calculateTotalInterest().toLocaleString("de-DE")} €
          </Typography.Text>
        </Card>

        <Card style={{ margin: "15px 15px 15px 0" }}>
          <Row style={{ gap: 15, alignItems: "center", marginBottom: 15 }}>
            <Button type="default" onClick={handlePrint}>
              Tabelle Drucken
            </Button>
            <Typography.Title style={{ margin: 0 }} level={5}>
              Legende:
            </Typography.Title>
            <Tooltip title="Eine Zeile wird rot markiert, wenn das Enddatum weniger als einen Monat in der Zukunft liegt. (bald abgelaufen)">
              <div
                style={{
                  width: 20,
                  height: 20,
                  backgroundColor: colorErrorBgHover,
                  display: "inline-block",
                }}
              ></div>
            </Tooltip>
          </Row>
          <Table
            className="table"
            dataSource={data}
            rowKey={(record, idx) => record.bankName + record.kontoNumber + idx}
            pagination={false}
            scroll={{ x: "max-content" }}
            rowClassName={(record) => {
              const now = dayjs();
              return record.endDatum.isBefore(now.add(1, "month"))
                ? "row-warning"
                : "";
            }}
            summary={() => (
              <Table.Summary fixed>
                <Table.Summary.Row style={{ fontWeight: "bold" }}>
                  {/* Column 0: Bank Name */}
                  <Table.Summary.Cell index={0}>Summe</Table.Summary.Cell>
                  {/* Column 1: Konto Nummer */}
                  <Table.Summary.Cell index={1} />
                  {/* Column 2: Startdatum */}
                  <Table.Summary.Cell index={2} />
                  {/* Column 3: Enddatum */}
                  <Table.Summary.Cell index={3} />
                  {/* Column 4: Zinssatz (%) */}
                  <Table.Summary.Cell index={4} />
                  {/* Column 5: Nominal (€) */}
                  <Table.Summary.Cell index={5}>
                    {data
                      ? data
                          .reduce((sum, entry) => sum + entry.nominal, 0)
                          .toLocaleString("de-DE", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })
                      : "0,00"}
                  </Table.Summary.Cell>
                  {/* Column 6: Zinsen (€) */}
                  <Table.Summary.Cell align="end" index={6}>
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
                  {/* Column 7: Kommulierte Zinsen bis Stichtag */}
                  <Table.Summary.Cell align="end" index={7}>
                    {data && quartalsEnde
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
                  {/* Column 8: Quartalszinsen (€) */}
                  <Table.Summary.Cell align="end" index={8}>
                    {data && quartalsBeginn && quartalsEnde
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
                  {/* Column 9: Bezahlte Zinsen */}
                  <Table.Summary.Cell align="end" index={9}>
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
                  {/* Column 10: Rückstellung */}
                  <Table.Summary.Cell align="end" index={10}>
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
                  {/* Column 11: Aktionen */}
                  <Table.Summary.Cell index={11} />
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
              title="Zinssatz (%)"
              width={120}
              dataIndex="zinssatz"
              key="zinssatz"
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
                    const newData = [...data];
                    newData[index] = {
                      ...record,
                      verbuchteRueckstellung: value || 0,
                    };
                    setData(newData);
                  }}
                />
              )}
            />
            <Table.Column
              width={150}
              align="right"
              title="Rückstellung (€)"
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
                  <Button danger icon={<DeleteOutlined />} />
                </Popconfirm>
              )}
            />
          </Table>
        </Card>
      </div>
      <FloatButton.Group
        style={{ insetInlineEnd: 24 }}
        trigger="click"
        icon={<SettingOutlined />}
      >
        <Tooltip placement="right" title={"Theme"}>
          <FloatButton
            icon={isDarkMode ? <SunOutlined /> : <MoonOutlined />}
            onClick={() => setDarkMode?.((prev) => !prev)}
          />
        </Tooltip>
      </FloatButton.Group>
    </Layout>
  );
}

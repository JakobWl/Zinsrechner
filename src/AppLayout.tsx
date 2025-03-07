import React, { useEffect, useState } from "react";
import dayjs, { Dayjs } from "dayjs";
import {
  Button,
  Card,
  DatePicker,
  DatePickerProps,
  FloatButton,
  Form,
  Input,
  InputNumber,
  Layout,
  Row,
  Table,
  theme,
  Tooltip,
  Typography,
} from "antd";
import { MoonOutlined, SettingOutlined, SunOutlined } from "@ant-design/icons";

interface KontoData {
  bankName: string;
  kontoNumber: string;
  startDatum: Dayjs;
  endDatum: Dayjs;
  zinssatz: number;
  nominal: number;
  zinsen?: number;
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
    const { bankName, kontoNumber, startDatum, endDatum, zinssatz, nominal } =
      values;
    const newKonto: KontoData = {
      bankName,
      kontoNumber,
      startDatum,
      endDatum,
      zinssatz: parseFloat(zinssatz),
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

  const handleQuartalsBeginnChange: DatePickerProps["onChange"] = (date) => {
    setQuartalsBeginn(date ? dayjs(date) : null);
  };

  const handleQuartalsEndeChange: DatePickerProps["onChange"] = (date) => {
    setQuartalsEnde(date ? dayjs(date) : null);
  };

  const handlePrint = () => {
    if (!data) return;
    // Sort and group data by bank name
    const sortedData = [...data].sort((a, b) =>
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

    // Calculate overall totals
    const totalNominal = data.reduce((sum, entry) => sum + entry.nominal, 0);
    const totalInterest = calculateTotalInterest();
    const totalQuarterlyInterest =
      quartalsBeginn && quartalsEnde ? calculateQuarterlyTotalInterest() : null;

    // Build table body content using multiple <tbody> elements
    let tableContent = "";
    Object.entries(groupedByBank).forEach(([bankName, entries]) => {
      // Build rows for the current bank group
      const groupRows = entries
        .map((entry) => {
          const monate = entry.endDatum.diff(entry.startDatum, "month");
          const singleInterest = calculateSingleInterest(entry);
          const quarterlyInterest = calculateQuarterlySingleInterest(entry);
          const verbuchte = entry.verbuchteRueckstellung || 0;
          const kommulierte = entry.kommulierteSumme || 0;
          return `
          <tr>
            <td>${entry.kontoNumber}</td>
            <td>${entry.startDatum.format("DD.MM.YYYY")}</td>
            <td>${entry.endDatum.format("DD.MM.YYYY")}</td>
            <td>${monate}</td>
            <td>${entry.zinssatz}</td>
            <td class="align-right">${entry.nominal.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td class="align-right">${singleInterest.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td class="align-right">${quarterlyInterest.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td class="align-right">${verbuchte.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td class="align-right">${kommulierte.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          </tr>
        `;
        })
        .join("");

      // Calculate group totals
      const groupNominal = entries.reduce(
        (sum, entry) => sum + entry.nominal,
        0,
      );
      const groupVerbuchte = entries.reduce(
        (sum, entry) => sum + (entry.verbuchteRueckstellung || 0),
        0,
      );
      const groupKommulierte = entries.reduce(
        (sum, entry) =>
          sum +
          (calculateQuarterlySingleInterest(entry) -
            (entry.verbuchteRueckstellung || 0)),
        0,
      );
      const groupInterest = entries.reduce(
        (sum, entry) => sum + calculateSingleInterest(entry),
        0,
      );
      const groupQuarterly = entries.reduce(
        (sum, entry) => sum + calculateQuarterlySingleInterest(entry),
        0,
      );

      // Append the group as a new <tbody>
      tableContent += `
      <tbody>
        <!-- Group header row with bank name -->
        <tr class="group-header">
          <td colspan="10" class="bank-title">${bankName}</td>
        </tr>
        ${groupRows}
        <!-- Group total row -->
        <tr style="font-weight: bold;">
          <td>Summe</td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
          <td class="align-right">${groupNominal.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td class="align-right">${groupInterest.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td class="align-right">${groupQuarterly.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td></td>
          <td class="align-right">${groupKommulierte.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        </tr>
      </tbody>
    `;
    });

    // Build the overall table HTML with a single <thead> and the multiple <tbody> elements
    const tableHTML = `
    <table>
      <thead>
        <tr>
          <th>Konto Nummer</th>
          <th>Startdatum</th>
          <th>Enddatum</th>
          <th>Mon.</th>
          <th>Zins</br>satz (%)</th>
          <th>Nominal (€)</th>
          <th>Zinsen (€)</th>
          <th>Quartalszinsen (€)</th>
          <th>Verbuchte Rückstellung (€)</th>
          <th>Kommulierte Summe (€)</th>
        </tr>
      </thead>
      ${tableContent}
    </table>
  `;

    // Build the final HTML content
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
          h1 {
            text-align: center;
            color: #4CAF50;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
            zoom: 0.8;
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
        </style>
      </head>
      <body>
        <h1>Konten Übersicht</h1>
        ${
          quartalsBeginn && quartalsEnde
            ? `<p>Quartalsbeginn: ${quartalsBeginn.format("DD.MM.YYYY")}, Quartalsende: ${quartalsEnde.format("DD.MM.YYYY")}</p>`
            : ""
        }
        ${tableHTML}
        <div class="summary">
          Gesamtsumme der Nominalwerte: €${totalNominal.toFixed(2)}<br/>
          Gesamtsumme der Zinsen: €${totalInterest.toFixed(2)}<br/>
          ${
            totalQuarterlyInterest !== null
              ? `Quartalszinsen: €${totalQuarterlyInterest.toFixed(2)}`
              : ""
          }
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
              label="Startdatum"
              name="startDatum"
              rules={[
                {
                  required: true,
                  message: "Bitte wählen Sie das Startdatum aus!",
                },
              ]}
            >
              <DatePicker format="DD.MM.YYYY" />
            </Form.Item>
            <Form.Item
              label="Enddatum"
              name="endDatum"
              rules={[
                {
                  required: true,
                  message: "Bitte wählen Sie das Enddatum aus!",
                },
              ]}
            >
              <DatePicker format="DD.MM.YYYY" />
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
          <Row>
            <Form
              layout="horizontal"
              style={{ display: "flex", alignItems: "center" }}
            >
              <Form.Item style={{ marginBottom: 0 }} label="Quartalsbeginn">
                <DatePicker
                  value={quartalsBeginn ? quartalsBeginn : undefined}
                  onChange={handleQuartalsBeginnChange}
                  format="DD.MM.YYYY"
                />
              </Form.Item>
              <Form.Item
                style={{ marginBottom: 0, marginLeft: 10 }}
                label="Quartalsende"
              >
                <DatePicker
                  value={quartalsEnde ? quartalsEnde : undefined}
                  onChange={handleQuartalsEndeChange}
                  format="DD.MM.YYYY"
                />
              </Form.Item>
              <Typography.Text style={{ marginLeft: 10 }}>
                Quartalszinsen:{" "}
                {calculateQuarterlyTotalInterest().toLocaleString("de-DE")} €
              </Typography.Text>
            </Form>
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
            <Tooltip title="Eine Zeile wird rot markiert, wenn das Enddatum weniger als einen Monat in der Zukunft liegt. (abgelaufen)">
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
                  {/* Column 7: Quartalszinsen (€) */}
                  <Table.Summary.Cell align="end" index={7}>
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
                  {/* Column 8: Verbuchte Rückstellung */}
                  <Table.Summary.Cell index={8} />
                  {/* Column 9: Kommulierte Summe */}
                  <Table.Summary.Cell align="end" index={9}>
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
                  {/* Column 10: Aktionen */}
                  <Table.Summary.Cell index={10} />
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
              key="startDatum"
              render={(date: Dayjs) => date.format("DD.MM.YYYY")}
            />
            <Table.Column
              width={120}
              title="Enddatum"
              dataIndex="endDatum"
              key="endDatum"
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
              fixed="right"
              width={120}
              align="right"
              title="Zinsen (€)"
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
              fixed="right"
              align="right"
              title="Quartalszinsen (€)"
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
              width={150}
              fixed="right"
              align="right"
              title="Verbuchte Rückstellung"
              key="verbuchteRueckstellung"
              render={(_, record: KontoData, index: number) => (
                <InputNumber
                  value={record.verbuchteRueckstellung}
                  min={0}
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
              fixed="right"
              width={150}
              align="right"
              title="Kommulierte Summe"
              key="kommulierteSumme"
              render={(_, record: KontoData) => {
                const quarterly = calculateQuarterlySingleInterest(record);
                const verbuchte = record.verbuchteRueckstellung || 0;
                const result = quarterly - verbuchte;
                return result.toLocaleString("de-DE", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                });
              }}
            />
            <Table.Column
              fixed="right"
              width={80}
              title="Aktionen"
              key="aktionen"
              render={(_, __, index: number) => (
                <Button danger onClick={() => handleDeleteKonto(index)}>
                  Löschen
                </Button>
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

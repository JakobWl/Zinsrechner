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
    // Gruppiere und sortiere die Daten
    const groupedData = data.sort((a, b) =>
      a.bankName.localeCompare(b.bankName),
    );

    // Berechne die Gesamtsumme der Nominalwerte
    const totalNominal = data.reduce((sum, entry) => sum + entry.nominal, 0);
    const totalInterest = calculateTotalInterest();
    const totalQuarterlyInterest =
      quartalsBeginn && quartalsEnde ? calculateQuarterlyTotalInterest() : null;

    // Verwende die preload-Skript-Methode, um ein Druckfenster in Electron zu erstellen
    window.ipcRenderer.send("create-print-window", {
      content: `
          <html lang="de">
              <head>
                  <title>Konten Übersicht</title>
                  <style>
                      body {
                          font-family: Arial, sans-serif;
                          margin: 20px;
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
                      .bank-group {
                          margin-top: 40px;
                      }
                      .bank-title {
                          font-size: 1.5em;
                          margin-top: 20px;
                          color: #333;
                      }
                      .total {
                          margin-top: 20px;
                          font-size: 1.2em;
                          font-weight: bold;
                      }
                  </style>
              </head>
              <body>
                  <h1>Konten Übersicht</h1>
                  ${groupedData
                    .map((entry, index, array) => {
                      const isNewGroup =
                        index === 0 ||
                        array[index - 1].bankName !== entry.bankName;
                      const isLastInGroup =
                        index === array.length - 1 ||
                        array[index + 1].bankName !== entry.bankName;

                      return `
                          ${
                            isNewGroup
                              ? `<div class="bank-group">
                                  <div class="bank-title">${entry.bankName}</div>
                                  <table>
                                  <thead><tr>
                                  <th>Konto Nummer</th><th>Startdatum</th>
                                  <th>Enddatum</th><th>Monate</th>
                                  <th>Zinssatz (%)</th><th>Nominal (€)</th>
                                  <th>Zinsen (€)</th><th>Quartalszinsen (€)</th>
                                  </tr>
                                  </thead><tbody>
                                `
                              : ""
                          }
                          <tr>
                              <td>${entry.kontoNumber}</td>
                              <td>${entry.startDatum.format("DD.MM.YYYY")}</td>
                              <td>${entry.endDatum.format("DD.MM.YYYY")}</td>
                              <td>${entry.endDatum.diff(entry.startDatum, "month")}</td>
                              <td>${entry.zinssatz}</td>
                              <td>${entry.nominal.toLocaleString("de-DE", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}</td>
                              <td class="align-right">${calculateSingleInterest(
                                entry,
                              ).toLocaleString("de-DE", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}</td>
                              <td class="align-right">${calculateQuarterlySingleInterest(
                                entry,
                              ).toLocaleString("de-DE", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}</td>
                          </tr>
                          ${isLastInGroup ? `</tbody></table></div>` : ""}
                      `;
                    })
                    .join("")}
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
      `,
    });
  };

  return (
    <Layout className="layout">
      <div style={{ minWidth: 350, width: "100%", flex: 1 }}>
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
      <div style={{ minWidth: 350, width: "100%", flex: 2 }}>
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
            <Tooltip title="Eine Zeile wird rot markiert, wenn das Enddatum weniger als einen Monat in der Zukunft liegt.">
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
            rowKey={(record) => record.bankName + record.kontoNumber}
            pagination={false}
            scroll={{ x: "max-content" }}
            rowClassName={(record) => {
              const now = dayjs();
              return record.endDatum.isBefore(now.add(1, "month"))
                ? "row-warning"
                : "";
            }}
          >
            <Table.Column
              title="Bank Name"
              width={120}
              dataIndex="bankName"
              key="bankName"
              fixed={"left"}
            />
            <Table.Column
              title="Konto Number"
              width={220}
              dataIndex="kontoNumber"
              fixed={"left"}
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
              width={120}
              title="Nominal (€)"
              dataIndex="nominal"
              key="nominal"
              render={(nominal: number) => nominal.toLocaleString("de-DE")}
            />
            <Table.Column
              fixed={"right"}
              width={120}
              align="right"
              title="Zinsen (€)"
              dataIndex="zinsen"
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
              fixed={"right"}
              width={150}
              align="right"
              title="Quartalszinsen (€)"
              dataIndex="quarterlyZinsen"
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
              fixed={"right"}
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

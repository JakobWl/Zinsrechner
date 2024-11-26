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
  const [data, setData] = useState<KontoData[]>([]);
  const [bankName, setBankName] = useState("");
  const [kontoNumber, setKontoNumber] = useState("");
  const [startDatum, setStartDatum] = useState<Dayjs | null>(null);
  const [endDatum, setEndDatum] = useState<Dayjs | null>(null);
  const [zinssatz, setZinssatz] = useState("");
  const [nominal, setNominal] = useState("");
  const [quartalsDatum, setQuartalsDatum] = useState<Dayjs | null>(null);

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
    // Save data to JSON file whenever data changes using the exposed preload functions, after initial load
    if (data.length > 0) {
      window.ipcRenderer.send("save-data", JSON.stringify(data, null, 2));
    }
  }, [data]);

  const handleAddKonto = () => {
    if (
      bankName &&
      kontoNumber &&
      startDatum &&
      endDatum &&
      zinssatz &&
      nominal
    ) {
      const newKonto: KontoData = {
        bankName,
        kontoNumber,
        startDatum,
        endDatum,
        zinssatz: parseFloat(zinssatz),
        nominal: parseFloat(nominal),
      };
      setData([...data, newKonto]);
      setBankName("");
      setKontoNumber("");
      setStartDatum(null);
      setEndDatum(null);
      setZinssatz("");
      setNominal("");
    }
  };

  const handleDeleteKonto = (index: number) => {
    const updatedData = [...data];
    updatedData.splice(index, 1);
    setData(updatedData);
  };

  const calculateTotalInterest = () => {
    return data.reduce((total, entry) => {
      const days = entry.endDatum.diff(entry.startDatum, "day");
      const interest = entry.nominal * (entry.zinssatz / 100) * (days / 365);
      return total + interest;
    }, 0);
  };

  const calculateQuarterlyInterest = () => {
    if (!quartalsDatum) return 0;
    return data.reduce((total, entry) => {
      if (quartalsDatum.isAfter(entry.startDatum)) {
        const days = quartalsDatum.diff(entry.startDatum, "day");
        const interest = entry.nominal * (entry.zinssatz / 100) * (days / 365);
        return total + interest;
      }
      return total;
    }, 0);
  };

  const handleStartDateChange: DatePickerProps["onChange"] = (date) => {
    setStartDatum(date ? dayjs(date) : null);
  };

  const handleEndDateChange: DatePickerProps["onChange"] = (date) => {
    setEndDatum(date ? dayjs(date) : null);
  };

  const handleQuartalsDateChange: DatePickerProps["onChange"] = (date) => {
    setQuartalsDatum(date ? dayjs(date) : null);
  };

  const handlePrint = () => {
    // Gruppiere und sortiere die Daten
    const groupedData = data.sort((a, b) =>
      a.bankName.localeCompare(b.bankName),
    );

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
                    <th>Enddatum</th><th>Monate Zwischen</th>
                    <th>Zinssatz (%)</th><th>Nominal (€)</th></tr></thead><tbody>`
                                : ""
                            }
                            <tr>
                                <td>${entry.kontoNumber}</td>
                                <td>${entry.startDatum.format("DD.MM.YYYY")}</td>
                                <td>${entry.endDatum.format("DD.MM.YYYY")}</td>
                                <td>${entry.endDatum.diff(entry.startDatum, "month")}</td>
                                <td>${entry.zinssatz}</td>
                                <td>${entry.nominal}</td>
                            </tr>
                            ${isLastInGroup ? `</tbody></table></div>` : ""}
                        `;
                      })
                      .join("")}
                </body>
            </html>
        `,
    });
  };

  return (
    <Layout className="layout">
      <div style={{ minWidth: 300 }}>
        <Card style={{ margin: 15 }}>
          <Form layout="vertical" onFinish={handleAddKonto}>
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
              <Input
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
              />
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
              <Input
                value={kontoNumber}
                onChange={(e) => setKontoNumber(e.target.value)}
              />
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
              <DatePicker
                value={startDatum ? startDatum : undefined}
                onChange={handleStartDateChange}
                format="DD.MM.YYYY"
              />
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
              <DatePicker
                value={endDatum ? endDatum : undefined}
                onChange={handleEndDateChange}
                format="DD.MM.YYYY"
              />
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
              <Input
                value={zinssatz}
                onChange={(e) => setZinssatz(e.target.value)}
                type="number"
              />
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
              <Input
                value={nominal}
                onChange={(e) => setNominal(e.target.value)}
                type="number"
              />
            </Form.Item>
            <Button type="primary" htmlType="submit">
              Hinzufügen
            </Button>
          </Form>
        </Card>
      </div>
      <div style={{ width: "100%" }}>
        <Card style={{ margin: "15px 15px 15px 0" }}>
          <Row>
            <Form
              layout="horizontal"
              style={{ display: "flex", alignItems: "center" }}
            >
              <Form.Item style={{ marginBottom: 0 }} label="Quartalsdatum">
                <DatePicker
                  value={quartalsDatum ? quartalsDatum : undefined}
                  onChange={handleQuartalsDateChange}
                  format="DD.MM.YYYY"
                />
              </Form.Item>
              <Typography.Text style={{ marginLeft: 10 }}>
                Quartalszinsen: {calculateQuarterlyInterest().toFixed(2)} €
              </Typography.Text>
            </Form>
          </Row>
        </Card>

        <Card style={{ margin: "15px 15px 15px 0" }}>
          <Typography.Text>
            Gesamtzinsen: {calculateTotalInterest().toFixed(2)} €
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
            rowKey={(record) => record.kontoNumber}
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

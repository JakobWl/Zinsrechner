import {useState, useEffect} from 'react';
import {Button, Input, DatePicker, Table, Card, Form, Typography, Row, Col} from 'antd';
import type {DatePickerProps} from 'antd';
import dayjs, {Dayjs} from 'dayjs';

interface KontoData {
    bankName: string;
    kontoNumber: string;
    startDatum: Dayjs;
    endDatum: Dayjs;
    zinssatz: number;
    nominal: number;
}

function App() {
    const [data, setData] = useState<KontoData[]>([]);
    const [bankName, setBankName] = useState('');
    const [kontoNumber, setKontoNumber] = useState('');
    const [startDatum, setStartDatum] = useState<Dayjs | null>(null);
    const [endDatum, setEndDatum] = useState<Dayjs | null>(null);
    const [zinssatz, setZinssatz] = useState('');
    const [nominal, setNominal] = useState('');
    const [quartalsDatum, setQuartalsDatum] = useState<Dayjs | null>(null);

    useEffect(() => {
        // Load data from JSON file on mount using the exposed preload functions
        window.ipcRenderer.invoke('load-data').then((fileData: string) => {
            if (fileData) {
                try {
                    const parsedData: KontoData[] = JSON.parse(fileData);
                    setData(parsedData.map(entry => ({
                        ...entry,
                        startDatum: dayjs(entry.startDatum),
                        endDatum: dayjs(entry.endDatum),
                    })));
                } catch (error) {
                    console.error('Error parsing JSON data:', error);
                }
            }
        });
    }, []);

    useEffect(() => {
        // Save data to JSON file whenever data changes using the exposed preload functions, after initial load
        if (data.length > 0) {
            window.ipcRenderer.send('save-data', JSON.stringify(data, null, 2));
        }
    }, [data]);

    const handleAddKonto = () => {
        if (bankName && kontoNumber && startDatum && endDatum && zinssatz && nominal) {
            const newKonto: KontoData = {
                bankName,
                kontoNumber,
                startDatum,
                endDatum,
                zinssatz: parseFloat(zinssatz),
                nominal: parseFloat(nominal),
            };
            setData([...data, newKonto]);
            setBankName('');
            setKontoNumber('');
            setStartDatum(null);
            setEndDatum(null);
            setZinssatz('');
            setNominal('');
        }
    };

    const handleDeleteKonto = (index: number) => {
        const updatedData = [...data];
        updatedData.splice(index, 1);
        setData(updatedData);
    };

    const calculateTotalInterest = () => {
        return data.reduce((total, entry) => {
            const days = entry.endDatum.diff(entry.startDatum, 'day');
            const interest = entry.nominal * (entry.zinssatz / 100) * (days / 365);
            return total + interest;
        }, 0);
    };

    const calculateQuarterlyInterest = () => {
        if (!quartalsDatum) return 0;
        return data.reduce((total, entry) => {
            if (quartalsDatum.isAfter(entry.startDatum)) {
                const days = quartalsDatum.diff(entry.startDatum, 'day');
                const interest = entry.nominal * (entry.zinssatz / 100) * (days / 365);
                return total + interest;
            }
            return total;
        }, 0);
    };

    const handleStartDateChange: DatePickerProps['onChange'] = (date) => {
        setStartDatum(date ? dayjs(date) : null);
    };

    const handleEndDateChange: DatePickerProps['onChange'] = (date) => {
        setEndDatum(date ? dayjs(date) : null);
    };

    const handleQuartalsDateChange: DatePickerProps['onChange'] = (date) => {
        setQuartalsDatum(date ? dayjs(date) : null);
    };

    const handlePrint = () => {
        // Use the preload script to create a print window in Electron
        window.ipcRenderer.send('create-print-window', {
            content: `
                <html lang="de">
                    <head>
                        <title>Konten Übersicht</title>
                        <style>
                            table {
                                width: 100%;
                                border-collapse: collapse;
                            }
                            table, th, td {
                                border: 1px solid black;
                            }
                            th, td {
                                padding: 8px;
                                text-align: left;
                            }
                        </style>
                    </head>
                    <body>
                        <h1>Konten Übersicht</h1>
                        <table>
                            <thead>
                                <tr>
                                    <th>Bank Name</th>
                                    <th>Konto Nummer</th>
                                    <th>Startdatum</th>
                                    <th>Enddatum</th>
                                    <th>Monate Zwischen</th>
                                    <th>Zinssatz (%)</th>
                                    <th>Nominal (€)</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${data.map((entry) => {
                const monthsBetween = entry.endDatum.diff(entry.startDatum, 'month');
                return `
                                        <tr>
                                            <td>${entry.bankName}</td>
                                            <td>${entry.kontoNumber}</td>
                                            <td>${entry.startDatum.format('DD.MM.YYYY')}</td>
                                            <td>${entry.endDatum.format('DD.MM.YYYY')}</td>
                                            <td>${monthsBetween}</td>
                                            <td>${entry.zinssatz}</td>
                                            <td>${entry.nominal}</td>
                                        </tr>
                                    `;
            }).join('')}
                            </tbody>
                        </table>
                    </body>
                </html>
            `,
        });
    };

    return (
        <div className="layout">
            <Row>
                <Col span={6} style={{minWidth: 300}}>
                    <Card style={{margin: 15}}>
                        <Form layout="vertical">
                            <Form.Item label="Bank Name">
                                <Input value={bankName} onChange={(e) => setBankName(e.target.value)}/>
                            </Form.Item>
                            <Form.Item label="Konto Nummer">
                                <Input value={kontoNumber} onChange={(e) => setKontoNumber(e.target.value)}/>
                            </Form.Item>
                            <Form.Item label="Startdatum">
                                <DatePicker value={startDatum ? startDatum : undefined} onChange={handleStartDateChange}
                                            format="DD.MM.YYYY"/>
                            </Form.Item>
                            <Form.Item label="Enddatum">
                                <DatePicker value={endDatum ? endDatum : undefined} onChange={handleEndDateChange}
                                            format="DD.MM.YYYY"/>
                            </Form.Item>
                            <Form.Item label="Zinssatz (%)">
                                <Input value={zinssatz} onChange={(e) => setZinssatz(e.target.value)} type="number"/>
                            </Form.Item>
                            <Form.Item label="Nominal (€)">
                                <Input value={nominal} onChange={(e) => setNominal(e.target.value)} type="number"/>
                            </Form.Item>
                            <Button type="primary" onClick={handleAddKonto}>Hinzufügen</Button>
                        </Form>
                    </Card>
                </Col>

                <Col span={18}>
                    <Card style={{margin: '15px 15px 15px 0'}}>
                        <Row>
                            <Form layout="horizontal" style={{display: 'flex', alignItems: 'center'}}>
                                <Form.Item style={{marginBottom: 0}} label="Quartalsdatum">
                                    <DatePicker value={quartalsDatum ? quartalsDatum : undefined}
                                                onChange={handleQuartalsDateChange} format="DD.MM.YYYY"/>
                                </Form.Item>
                                <Typography.Text
                                    style={{marginLeft: 10}}>Quartalszinsen: {calculateQuarterlyInterest().toFixed(2)} €</Typography.Text>
                            </Form>
                        </Row>
                    </Card>

                    <Card style={{margin: '15px 15px 15px 0'}}>
                        <Typography.Text
                            style={{marginLeft: 10}}>Gesamtzinsen: {calculateTotalInterest().toFixed(2)} €</Typography.Text>
                    </Card>

                    <Card style={{margin: '15px 15px 15px 0'}}>
                        <Button type="default" onClick={handlePrint} style={{margin: '15px'}}>Tabelle
                            Drucken</Button>
                        <Table
                            dataSource={data}
                            rowKey={(record) => record.kontoNumber}
                            pagination={false}
                            scroll={{x: 'max-content', y: 55 * 5}}
                            rowClassName={(record) => {
                                const now = dayjs();
                                return record.endDatum.isBefore(now.add(1, 'month')) ? 'row-warning' : '';
                            }}
                        >
                            <Table.Column title="Bank Name"
                                          width={120} dataIndex="bankName" key="bankName" fixed={'left'}/>
                            <Table.Column title="Konto Number" width={220} dataIndex="kontoNumber" fixed={'left'}
                                          key="kontoNumber"/>
                            <Table.Column width={120} title="Startdatum" dataIndex="startDatum" key="startDatum"
                                          render={(date: Dayjs) => date.format('DD.MM.YYYY')}/>
                            <Table.Column width={120} title="Enddatum" dataIndex="endDatum" key="endDatum"
                                          render={(date: Dayjs) => date.format('DD.MM.YYYY')}/>
                            <Table.Column title="Zinssatz (%)" width={120} dataIndex="zinssatz" key="zinssatz"/>
                            <Table.Column width={120} title="Nominal (€)" dataIndex="nominal" key="nominal"/>
                            <Table.Column fixed={'right'}
                                          width={80}
                                          title="Aktionen"
                                          key="aktionen"
                                          render={(_, __, index: number) => (
                                              <Button danger onClick={() => handleDeleteKonto(index)}>Löschen</Button>
                                          )}
                            />
                        </Table>
                    </Card>
                </Col>
            </Row>
        </div>
    );
}

export default App;

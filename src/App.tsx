import {useState, useEffect} from 'react';
import './App.css';
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
                            <Form layout="horizontal">
                                <Form.Item label="Quartalsdatum">
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
                        <Table dataSource={data} rowKey={(record) => record.kontoNumber} pagination={false}>
                            <Table.Column title="Bank Name" dataIndex="bankName" key="bankName"/>
                            <Table.Column title="Konto Number" dataIndex="kontoNumber" key="kontoNumber"/>
                            <Table.Column title="Startdatum" dataIndex="startDatum" key="startDatum"
                                          render={(date: Dayjs) => date.format('DD.MM.YYYY')}/>
                            <Table.Column title="Enddatum" dataIndex="endDatum" key="endDatum"
                                          render={(date: Dayjs) => date.format('DD.MM.YYYY')}/>
                            <Table.Column title="Zinssatz (%)" dataIndex="zinssatz" key="zinssatz"/>
                            <Table.Column title="Nominal (€)" dataIndex="nominal" key="nominal"/>
                            <Table.Column
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

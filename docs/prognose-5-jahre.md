# Vorschlag: 5-Jahres-Prognose für den Zinsrechner

**Status:** Konzept zur Freigabe. Die Rechen-Engine existiert bereits als Prototyp
(`src/utils/forecast.ts`) und ist mit 14 Tests abgesichert – **die UI ist noch nicht
angebunden**. Nichts am bestehenden Verhalten ändert sich, solange die Freigabe fehlt.

---

## 1. Ziel

Eine neue Ansicht beantwortet die Frage: **„Was passiert in den nächsten 5 Jahren,
wenn sich der Zinssatz verändert?“**

- Ausgangspunkt ist der **heute erfasste Bestand** (Banken, Nominale, Zinssätze,
  Laufzeiten, Zinsmethode).
- Der Anwender verschiebt den Marktzins (z. B. −0,5 pp pro Jahr, Zinsschock +2 pp)
  und sieht sofort, wie sich **Jahreszinsen, kumulierte Zinsen und Wiederanlagen**
  entwickeln.
- Ergebnis ist eine **nachvollziehbare Prognose mit klaren Annahmen**, keine
  Zusage. Ein Hinweis „unverbindliche Modellrechnung“ steht dauerhaft an der Ansicht.

Der Nutzen: Die vorhandene Quartalsauswertung zeigt die **Vergangenheit/Gegenwart**.
Die Prognose ergänzt genau die fehlende zeitliche Perspektive – ohne die bestehende
Berechnung anzufassen.

---

## 2. Was gerechnet wird (Modell)

Die Engine nutzt **ausschließlich** die vorhandene Berechnung aus
`src/utils/interestCalculation.ts` (`calculateInterest`). Es gibt keine zweite,
abweichende Zinsformel.

| Regel | Verhalten |
|---|---|
| Zinsbindung | Laufende Anlagen verzinsen sich **bis `endDatum` mit dem vertraglichen Zinssatz**. Das Szenario greift erst ab Fälligkeit. |
| Wiederanlage | Fälliges Nominal wird (anteilig, Standard 100 %) zum **Szenario-Marktzins am Wiederanlagetag** neu angelegt. |
| Laufzeit der Wiederanlage | Ursprungslaufzeit der Anlage (ganze Monate inkl. Endtag: 01.01.–31.12. = 12 Monate), optional überschreibbar. |
| Kapitalisierung | **Keine** – Zinsen werden wie im Rechner als Abgrenzung (KTO 2301) geführt, nicht dem Nominal zugeschlagen. |
| Zinsmethode | Die je Anlage gewählte Methode (`actual` / `30/360`) bleibt maßgeblich. |
| Horizont | Standard 5 Jahre ab Stichtag; Perioden werden exakt an Jahresgrenzen und am Horizontende abgeschnitten (keine Doppelzählung von Tagen). |
| Marktzins-Kurve | `linear` (Basissatz + Veränderung pro Jahr) oder `steps` (absolute Niveaus mit Startdatum); zusätzlich `shiftPp` als Zinsschock und Clamps `minRatePp`/`maxRatePp`. |

Der Marktzins wird **taggenau interpoliert** – ein Sprung mitten im Jahr wird also
anteilig als Mischzins abgebildet, nicht auf das ganze Jahr gelegt.

---

## 3. Eingaben in der UI

1. **Szenario-Vorlagen** (Ein-Klick, in `scenarioPresets` hinterlegt):
   - „Zins bleibt konstant“
   - „Zins steigt (+0,5 pp pro Jahr)“
   - „Zins fällt (−0,5 pp pro Jahr)“
   - „Zinsschock +2 pp (ab sofort)“
   - „Rückkehr auf 3,0 % in 2 Jahren“
2. **Feinsteuerung:** Basiszins (%) und Veränderung (pp/Jahr) als Zahlenfelder,
   plus Schnellbuttons `−0,25` / `−0,5` / `+0,25` / `+0,5` pp.
3. **Wiederanlage:** Anteil 0–100 % (Schieberegler) und Laufzeit („wie bisher“ oder
   Monatszahl). Damit lässt sich auch der Fall „ich lege nichts mehr an“ zeigen.
4. **Horizont:** 3 / 5 / 10 Jahre (Standard 5).
5. **Stichtag:** Standard heute, änderbar – so ist die Ansicht reproduzierbar.

Der Startwert für den Basiszins wird aus dem Bestand vorbelegt
(`currentAverageRatePp`, nominalgewichteter Durchschnitt).

---

## 4. Ausgabe

### 4.1 Jahrestabelle

Spalten: **Jahr · Zinsen · Kumulierte Zinsen · Nominal 01.01. · Nominal 31.12. ·
Fällig · Wiederangelegt · Ø Zins**.

Beispiel – Bestand 100.000 € zu 3 %, Vertrag bis 31.12.2025, Szenario
„Zins fällt −0,5 pp/Jahr“ ab 2,5 %:

| Jahr | Zinsen | Kumuliert | Fällig | Wiederangelegt | Ø Zins |
|---|---|---|---|---|---|
| 2025 | 3.000,00 € | 3.000,00 € | 100.000 € | – | 3,00 % |
| 2026 | 2.000,34 € | 5.000,34 € | 100.000 € | 100.000 € | 2,00 % |
| 2027 | 1.500,68 € | 6.501,02 € | 100.000 € | 100.000 € | 1,50 % |
| 2028 | 1.001,03 € | 7.502,05 € | 100.000 € | 100.000 € | 1,00 % |
| 2029 | 500,00 € | 8.002,05 € | – | 100.000 € | 0,50 % |
| **Summe** | **8.002,05 €** | | | | **Ø 1,60 %** |

### 4.2 Kennzahlen-Kacheln

- **Zinsertrag im Horizont** (Summe, €)
- **Ø Verzinsung** über den Horizont (%)
- **Nominal am Horizontende** (€)
- **Bandbreite:** dasselbe Szenario mit ±1 pp (in `forecastBand` bereits umgesetzt).
  Im Beispiel: −1 pp → 4.002,05 € (**−4.000 €**), +1 pp → 12.002,05 € (**+4.000 €**).

### 4.3 Diagramm

Gestapelte Balken/Säulen pro Jahr für *Zinsen* und *kumulierte Zinsen*, plus Linie für
den Ø Zins. Vorhandene Chart-Bibliothek wiederverwenden, sonst schlanke
Ant-Design-`Progress`/eigene SVG-Lösung (kein neues schweres Paket).

### 4.4 Export

Die Prognosetabelle über die bestehenden Export-Wege (Excel/PDF) mitgeben – gleiche
IPC-Handler wie `handleExportHistoryExcel` (`electron/main/index.ts`). Dateiname z. B.
`prognose_5_jahre_<Stichtag>.xlsx`.

---

## 5. Platzierung in der Oberfläche

Vorschlag: **eigene Card „Prognose (5 Jahre)“ direkt unter der Quartalsauswertung** –
also dort, wo der Anwender schon Kennzahlen liest, und ohne die Anlagenübersicht zu
verdrängen.

```
┌─ Prognose (5 Jahre) ──────────────────────────── [Konstant ▾] [±pp] ─┐
│  Basiszins 2,50 %   Änderung −0,50 pp/Jahr   Wiederanlage 100 % ▾    │
│  ┌ Zinsen Horizont ┐ ┌ Ø Verzinsung ┐ ┌ Nominal Ende ┐ ┌ Band ±1pp ┐ │
│  │   8.002,05 €    │ │    1,60 %     │ │  100.000 €   │ │ ±4.000 € │ │
│  └─────────────────┘ └───────────────┘ └──────────────┘ └──────────┘ │
│  ▁▃▅▆▇  Jahresverlauf                                                │
│  Jahrestabelle 2025–2029 …                              [Export] [PDF]│
│  ⓘ Modellrechnung auf Basis Ihrer Annahmen – keine Garantie.        │
└──────────────────────────────────────────────────────────────────────┘
```

Alternativ (falls die Seite zu voll wird): als **Reiter** neben „Anlagenübersicht“
oder als **Drawer**, geöffnet über den vorhandenen Menüpunkt
`historyMenuItems` → „Vorschau anzeigen“.

---

## 6. Technische Umsetzung

| Baustein | Datei | Status |
|---|---|---|
| Rechen-Engine (pure, UI-frei) | `src/utils/forecast.ts` | **fertig** (Prototyp) |
| Tests der Engine | `src/forecast.test.js` | **fertig** – 14 Tests grün, u. a. gegen `calculateInterest` verifiziert |
| UI-Komponente | `src/components/ForecastPanel.tsx` (neu) | offen |
| Einbindung | `src/AppLayout.tsx` (Card/Reiter, State für Szenario) | offen |
| Export | `electron/main/index.ts` (bestehende Handler erweitern) | offen |

Vorhandene öffentliche API (unverändert nutzbar):

```ts
forecast(accounts, { start, horizonYears: 5, scenario, reinvestShare, reinvestTermMonths })
forecastBand(accounts, opts, spreadPp = 1)   // Bandbreite ±1 pp
scenarioPresets(baseRatePp, start)           // 5 Vorlagen
currentAverageRatePp(accounts)               // Vorbelegung Basiszins
resolveRatePp(scenario, date, start)         // Kurve taggenau auswerten
```

Aufwandsschätzung (grob): UI-Panel inkl. Tabelle, Kacheln und Diagramm ≈ 1 Tag,
Export-Anbindung ≈ 2–3 h, Feinschliff/Barrierefreiheit ≈ 2 h.

---

## 7. Grenzen und Disclaimer

- **Keine Prognose im ökonomischen Sinn**, sondern eine **Was-wäre-wenn-Rechnung**
  auf Basis der eingegebenen Annahmen.
- Marktzins wird als **eine Kurve für alle Anlagen** angenommen; bankindividuelle
  Konditionen und Bonität bleiben außen vor.
- **Keine Kapitalisierung** der Zinsen (bewusst, passend zur KTO-2301-Logik).
  Ein Zinseszinsszenario wäre eine spätere Erweiterung (Schalter „Zinsen dem Nominal
  zuschlagen“).
- Steuern, Gebühren, vorzeitige Kündigung und Sondertilgungen sind nicht modelliert.
- Angezeigt wird immer der Satz: *„Unverbindliche Modellrechnung auf Basis Ihrer
  Annahmen. Tatsächliche Erträge können abweichen.“*

---

## 8. Offene Entscheidungen

1. **Platzierung:** eigene Card unter der Quartalsauswertung, Reiter oder Drawer?
2. **Diagramm:** vorhandene Chart-Bibliothek nutzen oder schlanke SVG-Lösung?
3. **Umfang der ersten Version:** nur Jahreszinsen (klein) oder gleich mit Export und
   Zinseszins-Schalter (groß)?

Nach Freigabe wird das Panel gebaut und die Engine dort angebunden; die Tests bleiben
als Regressionsschutz bestehen.

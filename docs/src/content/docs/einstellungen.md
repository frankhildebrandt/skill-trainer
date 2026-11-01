---
title: Alle Einstellungen und Schalter
description: Vollständige Referenz der Eingaben, Standardwerte, Modelle, Grenzen und Switches.
section: Referenz
order: 70
---

Die Werte auf dieser Seite gelten für eine neue Konfiguration. Die App lädt beim Start gespeicherte Einstellungen; deshalb kann dein Formular davon abweichen. Während eines Trainings sind die Einstellungen dieser Sitzung gesperrt.

![Trainingsformular und Budgets der App](/screenshots/settings.png)

*Originale App-Oberfläche mit Beispieldaten. Die Abbildung dokumentiert die Bedienoberfläche und keine echten Messergebnisse.*

## Workflow und Pfade

| Feld | Standard | Wirkung |
| --- | --- | --- |
| **Workflow** | Fine-Tuning | Vorhandenen Skill messen und verbessern, als Vortraining umarbeiten oder mit Create Skill neu erstellen. |
| **Skill-Name** | leer | Nur Create Skill. Kleinbuchstaben und Ziffern mit einzelnen Bindestrichen, etwa `api-tests`. |
| **Neuer Skill-Ordner** | leer | Nur Create Skill. Noch nicht existierender Zielordner; wird beim Übernehmen erstellt. |
| **Projekt** | leer | Grundlage der Trainingskopien. Für Fine-Tuning nötig; Home- und Stammordner werden abgewiesen. |
| **Skill** | leer | Vorhandenen Skill über Projekt-Dropdown oder **Wählen** laden. Ordner und `SKILL.md` sind zulässig. Ein einzelner Projekt-Skill wird bei leerer Auswahl automatisch gewählt. |
| **Skill beschreiben** | leer | Pflicht bei Create Skill. Beschreibe Einsatzfälle, Ablauf und Begleitdateien. |
| **Ziel des Vortrainings** | leer | Pflicht bei Vortraining. Beschreibe die gewünschten Änderungen am vorhandenen Skill. |

### Anschließend Fine-Tuning

**Standard: an.** Nur bei Vortraining und Create Skill sichtbar. Nach dem Entwurf folgen Vorprüfung, Baseline und Training. Projekt, Auftrag, Prüfung und Zielmodell sind erforderlich.

**Aus:** Es entsteht ausschließlich ein ungemessener Entwurf. Projektbezogene Trainingsfelder verschwinden; Projekt, Auftrag und Prüfbefehl werden nicht benötigt.

## Auftrag und Prüfung

| Feld | Standard | Wirkung |
| --- | --- | --- |
| **Trainingsauftrag** | leer | Hauptaufgabe, die Baseline und Gate in frischen Läufen bewerten. |
| **Aus Cursor-Läufen** | — | Öffnet lokale und Cloud-Läufe des gewählten Projekts. Suche in Aufträgen und Antworten; **Übernehmen** setzt den ausgewählten Prompt als Trainingsauftrag. |
| **Weitere Aufträge** | leer | Eine Variante pro Zeile. Mit Varianten verwendet das Training diese als zyklischen Pool, ohne Varianten den Hauptauftrag. Das Gate verwendet immer den Hauptauftrag. |
| **Prüfung → Testbefehl** | ausgewählt | Du gibst den auszuführenden Test selbst vor. |
| **Testbefehl** | leer | Pflicht im Befehlsmodus. Exit 0 bedeutet Erfolg; die Vorprüfung muss zunächst fehlschlagen. |
| **Prüfung → Agent schreibt das Testskript** | aus | Zielmodell erstellt zuerst `.skill-trainer/checks/run.sh`. Der Trainer stellt diese Prüfdateien vor Bewertungen wieder her. |

Beide Prüfmodi werden unter [Prüfung und Testskripte](/docs/pruefung/) erklärt.

## Ziel und Modelle

| Feld | Standard | Wirkung |
| --- | --- | --- |
| **Ziel → Allgemein** | ausgewählt | Optimierer soll ein wiederverwendbares Verfahren formulieren. |
| **Ziel → Dieser Auftrag / Dieser Zweck** | aus | Erlaubt konkrete Befehle, Pfade, APIs und Fallstricke für den angegebenen Auftrag beziehungsweise Zweck. |
| **In eigenen Worten** | leer | Zusätzliche Ausrichtung beim Fine-Tuning. Bei Entwurfsworkflows übernimmt die Pflichtbeschreibung diese Rolle. |
| **Zielmodell** | Composer 2.5 | Führt Training, Baseline und Gate aus. Erstellt bei Agent-Prüfung auch das Testskript. Ohne Fine-Tuning ausgeblendet. |
| **Optimierer** | Composer 2.5 | Erstellt Entwürfe und Vorschläge zur Überarbeitung des Skill-Ordners. |

Die Modellliste stammt aus dem Cursor-SDK. Beide Rollen dürfen dasselbe Modell verwenden; sie haben unterschiedliche Aufgaben im Ablauf.

## Umfang des Trainings

| Feld | Standard | Wirkung |
| --- | --- | --- |
| **Schritte** | 2 | Anzahl der regulären Zyklen aus Training, Optimierer und Gate. |
| **Training** | 2 | Trainingsläufe pro Schritt. |
| **Gate** | 2 | Frische Wiederholungen für Baseline und jedes Kandidaten-Gate einschließlich Slow-Update. |
| **Parallel** | 2 | Höchstzahl gleichzeitig ausgeführter Läufe in einem Trainings- oder Bewertungs-Batch. |
| **Lernrate (Text-Edits)** | 3 | Maximale Text-Edits eines Vorschlags. Sinkt über die Fine-Tuning-Schritte bis auf 1; bei einem einzigen Schritt bleibt sie am Startwert. Dateioperationen haben ein eigenes Budget. |

Alle numerischen Eingaben müssen positive ganze Zahlen sein. Die App setzt keine kleinen festen Höchstwerte für Schritte, Training oder Gate. Das Laufbudget prüft jedoch, ob die daraus berechnete Sitzung zulässig ist.

### Gate auf leerem Repository

**Standard: aus.** Baseline und Gate verwenden normalerweise frische Projektkopien.

**An:** Vorprüfung, Baseline und Gates verwenden neue leere Git-Repositories mit dem Skill und gegebenenfalls dem Prüfskript. **Training bleibt in Projektkopien.** Der Test muss im leeren Repo rot sein; im Trainingsprojekt darf er bereits grün sein. Geeignet für Skills, die ein Modul oder Add-on ohne vorhandenen Code erzeugen sollen.

Projektdateien und Projektabhängigkeiten stehen im leeren Gate nicht zur Verfügung. Der Zielagent hat dort Dateiwerkzeuge, aber keine Shell. Siehe [Trainingsablauf](/docs/training/#gate-auf-leerem-repository).

### Slow-Update

**Standard: an.** Nach den regulären Schritten folgt ein weiterer Optimierer-Vorschlag für eine dauerhafte Lernnotiz und gegebenenfalls weitere Änderungen. Er wird nur bei besserem Gate-Score behalten.

**Aus:** Dieser abschließende Vorschlag und sein Gate entfallen. Slow-Update vergrößert die maximale Laufzahl um einen Optimierer-Lauf und die eingestellten Gate-Wiederholungen.

## Zeitlimits

Öffne den Bereich **Zeitlimits**, um diese Werte zu ändern.

| Feld | Standard | Wirkung |
| --- | --- | --- |
| **Lauf (Minuten)** | 12 | Zeitlimit eines Trainings-, Baseline- oder Gate-Agenten. Kein Zeitlimit der gesamten Sitzung. |
| **Prüfung (Sekunden)** | 180 | Zeitlimit für eine Ausführung des Prüfbefehls, auch bei der Vorprüfung. |

Das Lauf-Zeitlimit gilt nicht als eigene Grenze für Optimierer-Vorschläge oder die vorbereitende Testskripterstellung. **Abbrechen** kann die Sitzung und ihre laufenden Agenten beenden.

## Edit-Budgets

Text-Edits und Dateioperationen werden getrennt begrenzt. Der Optimierer darf auch bei begrenzten Budgets `SKILL.md` vollständig über eine Dateioperation neu schreiben.

| Feld | Standard | Wirkung |
| --- | --- | --- |
| **Zeichen pro Text-Edit** | 1.800 | Maximale Inhaltslänge eines einzelnen Text-Edits. |
| **Neue Zeichen pro Schritt** | 2.500 | Budget der durch Text-Edits hinzugefügten Zeichen. Ersetzungen zählen mit ihrer positiven Längenzunahme, Löschungen fügen nichts hinzu. |
| **Datei-Edits pro Schritt** | 4 | Maximale Anzahl von Dateioperationen: schreiben, ersetzen oder löschen. |
| **Zeichen pro Datei-Edit** | 12.000 | Maximale Inhaltslänge einer einzelnen Dateioperation. |

Beim Slow-Update wird die Lernnotiz auf den kleineren Wert aus „Zeichen pro Text-Edit“ und „Neue Zeichen pro Schritt“ begrenzt, solange die Budgets aktiv sind.

### Optimizer ohne Edit-Budget

**Standard: aus.** Die eingestellten Grenzen und die Lernrate gelten.

**An:** Grenzen für Anzahl und Länge der Text-Edits sowie Dateioperationen werden aufgehoben. Die Lernrate wird ausgesetzt und ausgeblendet. Das erlaubt vollständige Neufassungen und umfangreiche Referenzen oder Skripte. Es hebt das Laufbudget und die Zeitlimits nicht auf.

## Laufbudget

### Ohne Laufbudget

**Standard: aus.** Unter **Maximale Agent-Läufe** ist **48** voreingestellt. Die App berechnet vor dem Start eine Obergrenze aus Baseline, Training, Gates, Optimierer, optionalem Entwurf und optionaler Testskripterstellung. Überschreitet diese das Budget, wird der Start abgewiesen.

**An:** Die Grenze für diese geplante Anzahl entfällt. Die Sitzung endet weiterhin nach ihren eingestellten Schritten; Zeitlimits bleiben bestehen. Schaltest du den Schalter wieder aus, setzt die App das Laufbudget auf 48.

Die Schätzung unter dem Formular ist kein Kostenbetrag. Mit den Standardwerten im Fine-Tuning und eigenem Testbefehl sind es bis zu **15 Agent-Läufe**: 12 Training/Baseline/Gate und 3 Optimierer. Der Wert 48 ist die erlaubte Obergrenze, nicht die standardmäßig ausgeführte Laufzahl.

Ein Entwurf ergänzt einen Optimierer-Lauf; ein Agent-Testskript einen weiteren Lauf. Gates ohne anwendbare Änderung entfallen, deshalb kann die tatsächliche Zahl geringer sein.

## Aktionsbuttons

- **Start:** Beginnt die Sitzung mit den aktuellen Einstellungen.
- **Abbrechen:** Bricht diese Sitzung ab. Bereits vorbereitete Entwürfe und die beste Fassung bleiben im Sitzungsbericht verfügbar.
- **+ Training:** Öffnet eine weitere Trainingssitzung und kopiert die Formulareinstellungen des aktiven Tabs.
- **Änderungen übernehmen:** Speichert das geänderte Skill-Ergebnis mit Backup bei vorhandenen Skills.
- **Sitzung öffnen:** Öffnet die gespeicherten Sitzungsunterlagen im Dateimanager.

Die letzten beiden Aktionen und die Bedeutung von „übernommen“ erklärt [Ergebnisse](/docs/ergebnisse/).

---
title: Ergebnisse und Änderungen übernehmen
description: Berichte, Scores, Diffs und Backups richtig lesen.
section: Anwendung
order: 60
---

Der Abschlussbericht im Verlauf zeigt die beste Fassung der Sitzung und ihre Änderungen. Bei gemessenen Läufen enthält er außerdem Baseline- und Bestwert sowie die Anzahl erfolgreicher Wiederholungen.

## Was bedeutet der Ergebnisstatus?

| Status | Bedeutung |
| --- | --- |
| **Bessere Fassung gemessen** | Der beste Gate-Score liegt über der Baseline. |
| **Entwurf vorbereitet · ungemessen** | Vortraining oder Create Skill hat einen geänderten Entwurf erstellt; eine Leistungsmessung liegt noch nicht vor. |
| **Entwurf trainiert** | Der Entwurf wurde gemessen, das anschließende Fine-Tuning hat aber keine zusätzliche Verbesserung gegenüber seiner Baseline gefunden. |
| **Keine Verbesserung** | Es gibt keine bessere Fassung gegenüber dem Ausgangsskill. |
| **Abgebrochen, Skill unverändert** | Die Sitzung endete ohne geänderte beste Fassung. Fehler und Abbruchhinweise stehen im Bericht. |

Bei einem Entwurfsworkflow beziehen sich Baseline und gemessene Verbesserung auf den **Skill nach dem Entwurf**. Der Entwurf selbst wird ohne Leistungsgate vorbereitet. Er kann deshalb auch bei einem späteren Fehler oder Abbruch noch als geändertes Ergebnis vorliegen.

## Schritte und Läufe untersuchen

Eine Schrittkarte zeigt die Begründung, angewandte Änderungen und die Gate-Werte vor und nach dem Vorschlag. **Übernommen** bedeutet hier: als beste Fassung innerhalb der Sitzung angenommen. Dein ursprünglicher Skill-Ordner ist dadurch noch nicht geändert.

**Verworfen** bedeutet, dass der Kandidat keine strikte Verbesserung erreicht hat oder keine Änderung angewendet werden konnte. **Kein Gate** erscheint bei Schritten ohne anwendbare Änderung.

Klicke im Verlauf einen Lauf an. Rechts kannst du die Ausgabe, Werkzeugaufrufe, Prüfresultate und den Diff betrachten. Bei einer erhaltenen fehlgeschlagenen Projektkopie führt **Kopie öffnen** zum betreffenden Ordner.

## Änderungen prüfen

Der Bericht zeigt Änderungen an `SKILL.md` und an Begleitdateien. Kontrolliere insbesondere neue oder geänderte Skripte, konkrete Pfade und Aussagen, die nur für das Trainingsprojekt gelten.

Der [Gate-Score](/docs/training/#wie-der-score-entsteht) bewertet die gewählte Prüfung und Werkzeugaufrufe. Ein höherer Score belegt eine Verbesserung für diese Messung; andere Aufgaben oder ungetestete Eigenschaften wurden damit nicht automatisch geprüft.

## In den Skill-Ordner schreiben

Klicke **Änderungen übernehmen**, wenn du die beste Fassung speichern möchtest. Der Button ist nur aktiv, wenn sich der Skill oder seine Begleitdateien geändert haben.

- Bei einem **vorhandenen Skill** sichert die App den vollständigen bisherigen Ordner neben dem Ziel als `<skill-ordner>.bak-<Zeitstempel>` und schreibt die neue Fassung.
- Bei **Create Skill** erstellt sie den neuen Zielordner. Existiert er inzwischen bereits, wird das Speichern abgewiesen.
- Gelöschte verwaltete Begleitdateien werden entfernt; Ausführungsrechte der Skripte bleiben Bestandteil des Ergebnisses.

Der Hinweis nach dem Speichern nennt Ziel- und gegebenenfalls Backup-Pfad. Der Button übernimmt den Skill-Ordner. Die in Trainingsläufen erzeugten Projektänderungen werden nicht in dein Projekt zurückgeschrieben.

Für eine Wiederherstellung kannst du den neuen Skill-Ordner beiseitelegen und den vollständigen Backup-Ordner wieder unter den ursprünglichen Namen setzen.

## Sitzung öffnen

**Sitzung öffnen** zeigt die gespeicherten Unterlagen im Dateimanager. Dort findest du unter anderem den ursprünglichen und besten Skill-Ordner, die Anfrage, Ereignisse und die Zusammenfassung. Die genaue Struktur erklärt [Dateien und Sicherheit](/docs/dateien-und-sicherheit/).

Die App speichert deine Formulareinstellungen. Eine vollständige Wiederherstellung aller geöffneten Trainings-Tabs und ihrer Laufansichten nach einem Neustart ist damit nicht verbunden.

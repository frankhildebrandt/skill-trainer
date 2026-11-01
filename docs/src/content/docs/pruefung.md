---
title: Prüfung und Testskripte
description: Erfolgskriterien definieren, die Vorprüfung verstehen und Testskripte verwenden.
section: Referenz
order: 80
---

Die Prüfung ist das messbare Erfolgskriterium. Nach einem Agent-Lauf führt der Trainer den Prüfbefehl selbst aus. **Exit 0 bedeutet Erfolg**, andere Exitcodes oder eine nicht ausführbare Prüfung zählen als Fehlschlag. Eine Erfolgsmeldung des Agenten allein reicht nicht.

## Einen Testbefehl angeben

Wähle **Prüfung → Testbefehl**. Gib einen Befehl an, der aus dem Projektverzeichnis gestartet werden kann, zum Beispiel:

```bash
npm test -- src/slug.test.ts
```

Der Befehl sollte das geforderte Verhalten testen. Eine reine Build-Prüfung erkennt eine fachlich falsche Lösung möglicherweise nicht. Ein bereits grünes Testsuite-Kommando belegt nicht, dass der Agent eine noch offene Aufgabe gelöst hat.

Bereite für eine neue Anforderung deshalb einen passenden fehlgeschlagenen Test vor. Achte darauf, dass dieser wegen des fehlenden Verhaltens scheitert und nicht wegen einer fehlenden Runtime oder defekter Abhängigkeiten.

## Den Agenten ein Testskript erstellen lassen

Mit **Agent schreibt das Testskript** erstellt das Zielmodell vor dem Training eine Prüfung. Der Einstiegspunkt ist:

```text
.skill-trainer/checks/run.sh
```

Der Trainer verwendet dafür:

```bash
sh .skill-trainer/checks/run.sh
```

Aus diesem vorbereitenden Lauf werden nur Dateien unter `.skill-trainer/checks/` übernommen. Der Agent soll die Prüfung schreiben und die eigentliche Aufgabe noch nicht lösen. Die App speichert die Prüfdateien in der Sitzung und stellt sie vor jeder Bewertung wieder her. Änderungen an diesem Ordner während eines Trainingslaufs ändern dadurch die anschließende Prüfung nicht.

Die Skripterstellung zählt als zusätzlicher Agent-Lauf. Die Vorprüfung kontrolliert anschließend, ob der Ausgangsstand tatsächlich noch rot ist. Prüfe das erzeugte Skript in den Sitzungsunterlagen, wenn sein Ergebnis nicht zu deiner Aufgabe passt.

## Warum die Vorprüfung fehlschlagen muss

Vor Baseline und Training führt die App die Prüfung auf einem frischen Ausgangsstand ohne Bearbeitung des Auftrags aus. Besteht sie dort, bricht Fine-Tuning ab. Sonst könnte ein Skill einen hohen Score erzielen, obwohl er die Aufgabe nicht bearbeitet.

Ein roter Ausgangstest ist nötig, aber allein noch kein Beleg für eine gute Prüfung. Ein Syntaxfehler im Test oder eine fehlende Abhängigkeit ist ebenfalls rot. Lies bei unerwarteten Ergebnissen die Prüfausgabe.

## Prüfung im leeren Repository

Bei **Gate auf leerem Repository** muss die Prüfung in einem neuen leeren Repo ausführbar sein. Dort gibt es den Skill und gegebenenfalls das vom Agenten geschriebene Prüfskript, aber keine Projektdateien oder kopierten Projektabhängigkeiten.

Die Prüfung muss scheitern, solange das verlangte Modul oder Add-on fehlt. Sie darf im Trainingsprojekt bereits grün sein. Ein einfaches `npm test`, das eine vorhandene `package.json` voraussetzt, eignet sich nicht automatisch für das leere Gate.

## Zeitlimit und Ausgaben

**Prüfung (Sekunden)** ist standardmäßig 180. Nach Ablauf beendet der Trainer den gestarteten Prüfprozess. Die Prüfausgabe erscheint in den Laufdetails; für den Score ist der Exitcode entscheidend.

Prüfbefehle laufen lokal über die Shell und erben die Umgebung der App. Dazu zählen verfügbare Programme und Umgebungsvariablen. Die Kopie bestimmt das Arbeitsverzeichnis, stellt aber keine Betriebssystem-Sandbox für beliebige Befehle dar. Details unter [Dateien und Sicherheit](/docs/dateien-und-sicherheit/).

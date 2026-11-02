---
title: Überblick
description: Was Skill Trainer verändert, wie die Workflows zusammenhängen und wo du anfängst.
section: Start
order: 10
---

Skill Trainer erstellt und verbessert Agent-Skills mit Cursor oder Codex App Server als Inference-Anbieter. Ein Skill besteht aus einer `SKILL.md` und optionalen Referenzen, Skripten oder weiteren Dateien. Die App kann diesen ganzen Ordner überarbeiten. Das Modell selbst bleibt unverändert.

Beim Fine-Tuning bearbeitet ein Zielmodell deinen Auftrag in frischen Projektkopien. Ein zweites, als Optimierer eingesetztes Modell wertet die Ergebnisse aus und schlägt Änderungen am Skill vor. Neue Läufe prüfen anschließend, ob die Kandidatenfassung besser abschneidet. Nur ein höherer Gate-Score wird innerhalb der Sitzung übernommen.

## Welcher Einstieg passt?

| Du möchtest … | Workflow | Weiter |
| --- | --- | --- |
| Einen vorhandenen Skill anhand einer überprüfbaren Aufgabe verbessern | Fine-Tuning | [Dein erster Lauf](/docs/erster-lauf/) |
| Einen vorhandenen Skill anhand einer Beschreibung umarbeiten | Vortraining | [Workflows](/docs/workflows/#vortraining) |
| Einen neuen Skill aus einer Beschreibung erstellen | Create Skill | [Workflows](/docs/workflows/#create-skill) |

Vortraining und Create Skill erzeugen zunächst einen **ungemessenen Entwurf**. Erst ein anschließendes Fine-Tuning bewertet dessen Leistung. Der Bericht unterscheidet diese Ergebnisse ausdrücklich.

![Skill Trainer mit Einstellungen, Verlauf und Agentenansicht](/screenshots/training.png)

*Originale App-Oberfläche mit Beispieldaten. Die dargestellten Werte sind keine echten Messergebnisse.*

## So ist die App aufgebaut

- **Links:** Workflow, Projekt, Skill, Auftrag, Prüfung und Budgets. Unter dem Formular siehst du die geschätzte maximale Zahl der Agent-Läufe und startest die Sitzung.
- **In der Mitte:** Der Verlauf zeigt Phasen, einzelne Läufe, Vorschläge und den Abschlussbericht.
- **Rechts:** Klicke einen Lauf im Verlauf an, um dessen Ausgabe und Werkzeugaufrufe zu öffnen.
- **Oben:** Trainings-Tabs und die Anmeldung des im aktiven Tab gewählten Anbieters. Über **+ Training** legst du eine weitere Sitzung mit den Einstellungen des aktiven Tabs an.

Die Trennlinien zwischen den Bereichen lassen sich verschieben. Du kannst mehrere Trainings in eigenen Tabs laufen lassen. Schließt du einen laufenden Trainings-Tab, bricht die App diese Sitzung ab.

## Was wird gespeichert?

Während des Trainings liegen Änderungen am Skill in der Sitzung. Erst **Änderungen übernehmen** schreibt sie in den gewählten Skill-Ordner und erstellt bei vorhandenen Skills ein Backup. Änderungen am trainierten Projekt werden nicht zurückgeschrieben. Mehr dazu unter [Dateien und Sicherheit](/docs/dateien-und-sicherheit/).

Starte mit der [Installation](/docs/installation/) und anschließend mit [deinem ersten Lauf](/docs/erster-lauf/). Die [Einstellungsreferenz](/docs/einstellungen/) erklärt jedes Feld und jeden Schalter.

---
title: Die drei Workflows
description: Fine-Tuning, Vortraining und Create Skill passend einsetzen.
section: Anwendung
order: 40
---

Der **Workflow** entscheidet, ob du einen Skill anhand gemessener Läufe verbesserst oder zuerst aus einer Beschreibung einen Entwurf vorbereitest.

## Fine-Tuning

Wähle Fine-Tuning, wenn ein Skill vorhanden ist und du seine Leistung an einer überprüfbaren Aufgabe messen möchtest.

Du gibst Projekt, Skill, Trainingsauftrag, Prüfung und Modelle an. Die App misst eine Baseline, sammelt Trainingsläufe und lässt den Optimierer einen Kandidaten vorschlagen. Nur ein Kandidat mit strikt höherem Gate-Score ersetzt innerhalb der Sitzung die bisherige beste Fassung. Gleichstand wird verworfen.

Unter **Ziel → In eigenen Worten** kannst du zusätzlich beschreiben, worauf der Skill ausgerichtet sein soll. Die [Trainingsschleife](/docs/training/) erklärt den Ablauf im Detail.

## Vortraining

Wähle Vortraining, wenn du einen vorhandenen Skill anhand einer Beschreibung neu ordnen, erweitern oder überarbeiten möchtest.

1. Wähle den vorhandenen Skill-Ordner.
2. Beschreibe unter **Ziel des Vortrainings** die Einsatzfälle und gewünschten Änderungen.
3. Wähle den **Optimierer** und passende Edit-Budgets.
4. Entscheide, ob **Anschließend Fine-Tuning** eingeschaltet bleibt.

Der Optimierer darf `SKILL.md`, Referenzen und Skripte bearbeiten. Der Entwurf wird auf anwendbare Änderungen und erforderliches Frontmatter geprüft, aber zunächst **ohne Leistungsgate** in die Sitzung übernommen.

Mit anschließendem Fine-Tuning dient dieser Entwurf als neue Baseline. Die Leistung des ursprünglichen Skills wird in diesem Workflow nicht vor dem Entwurf gemessen. Ein späterer Gate-Anstieg beschreibt deshalb die zusätzliche Verbesserung gegenüber dem Entwurf.

## Create Skill

Wähle Create Skill, wenn du noch keinen Skill hast.

![Create-Skill-Workflow in der App](/screenshots/create-skill.png)

*Originale App-Oberfläche mit Beispieldaten. Der gezeigte Entwurf ist kein gemessenes Trainingsergebnis.*

1. Vergib einen **Skill-Name**, etwa `typescript-tests`. Erlaubt sind Kleinbuchstaben und Ziffern mit einzelnen Bindestrichen zwischen den Teilen.
2. Wähle einen **neuen Skill-Ordner**. Der Zielordner darf noch nicht existieren.
3. Formuliere unter **Skill beschreiben** den Zweck, die Auslöser, den gewünschten Ablauf sowie benötigte Referenzen und Skripte.
4. Wähle Optimierer, Budgets und gegebenenfalls das anschließende Fine-Tuning.

Der Optimierer erstellt eine `SKILL.md` mit `name` und `description` im YAML-Frontmatter und kann Begleitdateien hinzufügen. Der Zielordner entsteht erst, wenn du das Ergebnis übernimmst.

## „Anschließend Fine-Tuning“

Der Schalter ist bei Vortraining und Create Skill standardmäßig **an**. Dann musst du zusätzlich Projekt, Trainingsauftrag, Prüfung und Zielmodell konfigurieren.

Schaltest du ihn aus, wird nur ein Entwurf erstellt. Die projektbezogenen Trainingsfelder verschwinden. Du benötigst dann weder Projektordner noch Trainingsauftrag oder Prüfbefehl. Der Bericht bezeichnet das Ergebnis als **Entwurf vorbereitet · ungemessen**.

Ein bereits vorbereiteter Entwurf bleibt erhalten, wenn eine spätere Vorprüfung fehlschlägt oder du das anschließende Training abbrichst. Du kannst ihn prüfen, speichern und später in einem eigenen Fine-Tuning messen.

## Allgemein oder für diesen Zweck?

**Ziel → Allgemein** fordert ein wiederverwendbares Vorgehen. **Dieser Auftrag** beziehungsweise **Dieser Zweck** erlaubt dem Optimierer, konkrete Befehle, Pfade und APIs für diese Aufgabe in den Skill aufzunehmen. Auch dabei soll ein Arbeitsablauf entstehen, keine einkopierte fertige Lösung.

Alle Felder und ihre Standardwerte stehen in der [Einstellungsreferenz](/docs/einstellungen/).

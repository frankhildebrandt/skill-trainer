---
title: Dein erster Lauf
description: Einen vorhandenen Skill mit einer konkreten Aufgabe prüfen und verbessern.
section: Start
order: 30
---

Dieser Ablauf führt dich durch ein Fine-Tuning mit einem vorhandenen Skill. Du brauchst eine [gestartete und angemeldete App](/docs/installation/), einen Projektordner und eine überprüfbare, noch ungelöste Aufgabe.

## 1. Projekt und Skill wählen

Lass **Workflow → Fine-Tuning** ausgewählt und prüfe den **Inference-Anbieter**: Cursor ist voreingestellt. Codex App Server verwendet deine Codex-Anmeldung; weitere Anbieter verwenden den eingestellten API-Endpunkt und gegebenenfalls die Schlüsselvariable. Klicke bei **Projekt** auf **Wählen** und öffne den Projektordner. Die App sucht darin nach `SKILL.md`-Dateien. Wenn sie genau einen Skill findet und noch keiner ausgewählt ist, wählt sie diesen automatisch aus.

Bei mehreren Skills verwendest du das Dropdown. Über **Skill → Wählen** kannst du auch einen Skill außerhalb des Projekts laden. Du darfst den ganzen Skill-Ordner oder seine `SKILL.md` auswählen; Referenzen und Skripte im Ordner werden mitgenommen.

## 2. Einen konkreten Auftrag formulieren

Beschreibe unter **Trainingsauftrag**, was das Zielmodell im Projekt erledigen soll. Nenne das erwartete Verhalten und relevante Randfälle. Beispiel:

> Ergänze für die Slug-Funktion die Behandlung von Umlauten und mehrfachen Leerzeichen. Die vorhandene API soll erhalten bleiben. Die neuen Tests müssen bestehen.

Über **Aus Cursor-Läufen** kannst du stattdessen den Auftrag eines vorhandenen lokalen oder Cloud-Laufs dieses Repositorys übernehmen. Im Auswahlfenster suchst du in Aufträgen und Antworten, filterst nach **Alle**, **Lokal** oder **Cloud** und bestätigst mit **Übernehmen**. Diese Auswahl zeigt bei jedem Inference-Anbieter ausschließlich die Cursor-Historie.

Lass **Weitere Aufträge** für den ersten Versuch leer. Dann verwenden Training und Gate denselben Hauptauftrag, jeweils in eigenen frischen Läufen.

## 3. Prüfung festlegen

Wähle **Testbefehl** und gib einen Befehl ein, der genau die Aufgabe prüft, etwa:

```bash
npm test -- src/slug.test.ts
```

Der Test muss auf dem Ausgangsstand fehlschlagen und nach der gewünschten Änderung Exit 0 liefern. Ein bereits grünes `npm test` reicht nicht. Alternativ lässt du über **Agent schreibt das Testskript** vor dem Training eine Prüfung erstellen.

Die [Prüfungsdokumentation](/docs/pruefung/) erklärt beide Varianten und die Vorprüfung.

## 4. Einstellungen prüfen und starten

Für einen ersten Versuch kannst du die Standardwerte verwenden: **2 Schritte**, **2 Training**, **2 Gate**, **2 Parallel**. **Slow-Update** ist an. Daraus ergeben sich mit eigenem Testbefehl bis zu **15 Agent-Läufe**. Ein vom Agenten geschriebenes Testskript kommt als zusätzlicher Lauf dazu.

Prüfe die Schätzung unter dem Formular und klicke **Start**. Die Vorprüfung führt den Test zunächst auf einer frischen Ausgangskopie aus. Ein Fehlschlag ist hier die gewünschte Ausgangslage.

## 5. Verlauf und Ergebnis lesen

Im Verlauf erscheinen Baseline, Trainingsläufe, Optimierer und Gate. Klicke einen Agent-Lauf an, um rechts seine Details zu lesen. Eine Schrittkarte zeigt, ob der Kandidat innerhalb der Sitzung **übernommen** oder **verworfen** wurde.

Der Bericht vergleicht die Baseline mit der besten Fassung und zeigt Änderungen an `SKILL.md` und Begleitdateien. Prüfe diese, bevor du **Änderungen übernehmen** klickst. Erst dieser Button schreibt den Skill zurück und sichert einen vorhandenen Skill-Ordner als Backup.

Die App übernimmt dabei den verbesserten Skill, nicht die vom Zielmodell erzeugten Projektänderungen. Unter [Ergebnisse](/docs/ergebnisse/) findest du die Bedeutung der Anzeigen und die verfügbaren Folgeaktionen.

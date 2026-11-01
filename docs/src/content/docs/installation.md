---
title: Installation und Anmeldung
description: Skill Trainer aus dem Repository starten und mit Cursor verbinden.
section: Start
order: 20
---

Skill Trainer läuft als Electron-Desktop-App. Zum Start aus dem Repository benötigst du **Node.js ab Version 22.13**, npm und Git. Die Agent-Läufe verwenden das Cursor-SDK und eine Cursor-Anmeldung oder einen API-Key.

Die Projektkopien verwenden außerdem `tar` und beim Kopieren vorhandener `node_modules`-, `.venv`- oder `venv`-Ordner den Befehl `cp -cR`. Diese Clone-Option steht unter macOS zur Verfügung. Prüfe sie auf anderen Systemen; die aktuelle Implementierung enthält dafür keinen Ersatz.

## App starten

Führe im Hauptverzeichnis dieses Repositorys aus:

```bash
npm install
npm test
npm run dev
```

`npm run dev` baut und öffnet die App im Entwicklungsmodus. `npm run build` erstellt den App-Build. Diese Dokumentation setzt keine fertigen Installationspakete voraus.

Falls Electron nicht heruntergeladen wurde und das Fenster deshalb nicht startet:

```bash
node node_modules/electron/install.js
npm run dev
```

## Mit Cursor verbinden

Klicke im App-Fenster oben auf **Anmelden**. Das Cursor-SDK öffnet den Browser für die Anmeldung. Danach zeigt die App deinen Anmeldestatus und lädt die verfügbaren Modelle. Die vom SDK gespeicherten Anmeldedaten liegen unter `~/.cursor/sdk/auth.json`.

Alternativ kannst du `CURSOR_API_KEY` in der Umgebung setzen, aus der du die App startest. Die Statusanzeige zeigt dann **API-Key**. Trage den Schlüssel weder in den Trainingsauftrag noch in einen Skill ein.

Die Modellaufrufe werden über deine Cursor-Nutzung abgerechnet. Edit- und Laufbudgets sind Grenzen der App; sie sind kein Geld- oder Tokenbudget.

## Projekt vorbereiten

Für Fine-Tuning brauchst du einen konkreten Projektordner und einen Test, der die noch offene Aufgabe erkennt. Installiere die Abhängigkeiten des Projekts und prüfe, ob der gewünschte Testbefehl dort ausführbar ist. Der Ausgangstest muss fehlschlagen, weil die Aufgabe noch nicht erfüllt ist.

Für Vortraining oder Create Skill ohne anschließendes Fine-Tuning reichen ein Skill beziehungsweise ein neuer Zielordner und eine Beschreibung. Ein Projekt und ein Prüfbefehl werden dann nicht benötigt.

Weiter mit [Dein erster Lauf](/docs/erster-lauf/) oder der [Workflow-Auswahl](/docs/workflows/).

---
title: Installation und Anmeldung
description: Skill Trainer aus dem Repository starten und mit Cursor oder Codex verbinden.
section: Start
order: 20
---

Skill Trainer läuft als Electron-Desktop-App. Zum Start aus dem Repository benötigst du **Node.js ab Version 22.13**, npm und Git. Als Inference-Anbieter wählst du Cursor oder Codex App Server. Die Anmeldung und die verfügbaren Modelle richten sich nach diesem Anbieter.

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

Lass im Trainingsformular **Inference-Anbieter → Cursor** ausgewählt und klicke im App-Fenster oben auf **Anmelden**. Das Cursor-SDK öffnet den Browser für die Anmeldung. Danach zeigt die App deinen Anmeldestatus und lädt die verfügbaren Modelle. Die vom SDK gespeicherten Anmeldedaten liegen unter `~/.cursor/sdk/auth.json`.

Alternativ kannst du `CURSOR_API_KEY` in der Umgebung setzen, aus der du die App startest. Die Statusanzeige zeigt dann **API-Key**. Trage den Schlüssel weder in den Trainingsauftrag noch in einen Skill ein.

Die Modellaufrufe werden über deine Cursor-Nutzung abgerechnet.

## Mit Codex App Server verbinden

Installiere die [Codex CLI](https://learn.chatgpt.com/docs/cli) ab Version **0.166.0** und melde dich an:

```bash
npm install -g @openai/codex
codex login
codex login status
```

`codex` muss für den Prozess verfügbar sein, der Skill Trainer startet. Die App sucht im `PATH` und in üblichen Installationsverzeichnissen; mit `CODEX_APP_SERVER_BIN` kannst du den vollständigen Pfad zur ausführbaren Datei vorgeben. Wähle dann im Trainingsformular **Inference-Anbieter → Codex App Server**. Die App übernimmt die vorhandene Codex-Anmeldung und lädt den Modellkatalog des App Servers. Du kannst dich auch über **Anmelden** in der App verbinden. Die [offizielle OpenAI-Dokumentation zur Authentifizierung](https://learn.chatgpt.com/docs/auth) erklärt die verfügbaren Anmeldearten.

Skill Trainer startet den App Server selbst als lokalen Unterprozess und kommuniziert über `stdio`. Du musst keinen Server und keinen Port einrichten. Die gewählte Codex-Anmeldung bestimmt den Modellzugang und die Abrechnung.

Die Anbieterwahl gilt pro Trainings-Tab für Training, Optimierer, Entwürfe, Skill-Analyse und Testskripterstellung. Die Kopfzeile zeigt den Anmeldestatus des aktiven Tabs. Bei einem Anbieterwechsel wählst du Modelle aus dessen eigener Liste. Ältere gespeicherte Einstellungen verwenden weiterhin Cursor.

Edit- und Laufbudgets sind Grenzen der App; sie sind kein Geld- oder Tokenbudget.

## Projekt vorbereiten

Für Fine-Tuning brauchst du einen konkreten Projektordner und einen Test, der die noch offene Aufgabe erkennt. Installiere die Abhängigkeiten des Projekts und prüfe, ob der gewünschte Testbefehl dort ausführbar ist. Der Ausgangstest muss fehlschlagen, weil die Aufgabe noch nicht erfüllt ist.

Für Vortraining oder Create Skill ohne anschließendes Fine-Tuning reichen ein Skill beziehungsweise ein neuer Zielordner, eine Beschreibung und der Projektordner. Der Entwurf liest diese Codebase, bevor er den Skill schreibt. Ein Prüfbefehl wird dann nicht benötigt.

Weiter mit [Dein erster Lauf](/docs/erster-lauf/) oder der [Workflow-Auswahl](/docs/workflows/).

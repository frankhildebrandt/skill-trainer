---
title: Fehlerbehebung
description: Häufige Start-, Prüfungs-, Budget- und Speicherprobleme lösen.
section: Referenz
order: 100
---

## Das Electron-Fenster öffnet sich nicht

Prüfe, ob du Node.js ab 22.13 verwendest und `npm install` im Hauptverzeichnis ausgeführt hast. Wenn der Electron-Download fehlt:

```bash
node node_modules/electron/install.js
npm run dev
```

Im normalen Browser läuft die Desktop-App nicht; sie benötigt die Electron-Anbindung. Die Astro-Seite ist die Produktdokumentation.

## Anmeldung oder Modellaufruf schlägt fehl

Prüfe zuerst den **Inference-Anbieter** im aktiven Trainings-Tab. Bei Cursor oder Codex klicke oben auf **Anmelden** und schließe die Browser-Anmeldung für diesen Anbieter ab. Bei Cursor muss ein alternativ verwendeter API-Key als `CURSOR_API_KEY` in der Umgebung des Prozesses verfügbar sein, der die App startet. Eine Variable in einem anderen Terminal wird nicht automatisch übernommen.

Nach der Anmeldung lädt die App die Modellliste erneut. Wenn nur das vorausgewählte Composer-Modell erscheint, prüfe die Cursor-Verbindung und die Fehlermeldung im Verlauf.

Bei **Codex App Server** muss die App `codex` finden können. Prüfe im selben Terminal `codex --version` und `codex login status`; melde dich bei Bedarf mit `codex login` an und starte die App erneut. Bei einer Installation außerhalb des `PATH` und der üblichen Installationsverzeichnisse kannst du `CODEX_APP_SERVER_BIN` auf den vollständigen Pfad zur ausführbaren Datei setzen. Aktualisiere ältere Codex-Versionen auf mindestens **0.166.0**, damit das benötigte App-Server-Protokoll verfügbar ist. Es muss keine separat gestartete Serverinstanz laufen. Eine leere Codex-Modellliste ist kein Grund, ein Cursor-Modell einzutragen; prüfe die angezeigte Codex-Fehlermeldung und Anmeldung.

Bei **OpenAI, OpenRouter oder lokalen API-Endpunkten** prüfe die API-Basis-URL einschließlich des API-Präfixes wie `/v1`. Trage nur den Namen der Schlüsselvariable ein und stelle sicher, dass ihr Wert in der Umgebung des App-Prozesses vorhanden ist. Lade bei lokalen Servern ein Modell mit Tool-Calling-Unterstützung. Falls `GET /models` keine Liste liefert, kannst du die Modell-ID direkt in die Modellfelder eintragen.

## „Der Prüfbefehl ist … schon erfolgreich“

Die Vorprüfung erwartet einen roten Ausgangstest. Wähle eine noch offene Aufgabe und eine Prüfung, die genau das fehlende Verhalten erkennt. Bei **Gate auf leerem Repository** muss die Prüfung dort fehlschlagen; im Trainingsprojekt darf sie bereits bestehen.

Ein beliebiges bereits grünes `npm test` reicht nicht. Lies [Prüfung und Testskripte](/docs/pruefung/), um ein passendes Erfolgskriterium zu setzen.

## Das Testskript fehlt oder ist ungültig

Beim Modus **Agent schreibt das Testskript** muss der Agent `.skill-trainer/checks/run.sh` erzeugen. Eine leere Datei genügt nicht. Nur Dateien unter `.skill-trainer/checks/` werden als Prüfung übernommen.

Öffne die Sitzung und kontrolliere das erzeugte Skript sowie den Testskript-Lauf. Beschreibe im Trainingsauftrag das erwartete Verhalten genauer oder verwende einen selbst vorbereiteten Testbefehl.

## „Laufbudget überschritten“

Die geplante maximale Zahl der Agent-Läufe übersteigt **Maximale Agent-Läufe**. Erhöhe diese Grenze, reduziere Schritte, Training oder Gate-Wiederholungen oder schalte **Ohne Laufbudget** ein. Auch Slow-Update, Entwurf und Agent-Testskript tragen zur Schätzung bei.

Das Laufbudget zählt geplante Modellläufe, keine Kosten. Die [Einstellungsreferenz](/docs/einstellungen/#laufbudget) erklärt die Standardwerte.

## Ein Lauf oder eine Prüfung dauert zu lange

Erhöhe bei berechtigtem Bedarf unter **Zeitlimits** das Limit für **Lauf (Minuten)** oder **Prüfung (Sekunden)**. Prüfe vorher, ob der Test ohne Interaktion läuft und nicht auf Eingaben wartet.

Das Lauf-Zeitlimit begrenzt Trainings-, Baseline- und Gate-Läufe; es ist keine separate Zeitgrenze für den Optimierer, die vorbereitende Testskripterstellung oder die gesamte Sitzung. Über **Abbrechen** kannst du die Sitzung beenden.

## Die Kopie von Abhängigkeiten schlägt fehl

Die App verwendet für vorhandene `node_modules`-, `.venv`- und `venv`-Verzeichnisse `cp -cR`. Prüfe, ob diese Clone-Option auf deinem System verfügbar ist und Quell- und Zielverzeichnisse zugänglich sind. Die App weicht nicht auf Links zum Original aus.

Prüfe außerdem Git und `tar`, die für Projektkopien benötigt werden. Wähle einen konkreten Projektordner; Home- und Stammverzeichnisse werden absichtlich abgewiesen.

## Im leeren Gate fehlt das Projekt

Das ist bei **Gate auf leerem Repository** das gewünschte Verhalten. Nur Training nutzt Projektkopien. Baseline und Gate müssen mit Skill und gegebenenfalls Prüfskript auskommen.

Bringe notwendige Referenzen oder Vorlagen im Skill unter. Der Zielagent hat im leeren Gate keine Shell. Wenn dein Auftrag auf vorhandenen Projektdateien aufbaut, schalte das leere Gate aus.

## Keine Verbesserung oder „kein Gate“

Ein Kandidat muss den bisherigen Gate-Score strikt übertreffen. Gleichstand wird verworfen. Prüfe, ob Test und Auftrag zusammenpassen und ob der Verlauf konkrete Ursachen zeigt.

**Kein Gate** bedeutet, dass kein anwendbarer Kandidat entstand. Mögliche Gründe sind überschrittene Edit-Budgets, nicht gefundene oder mehrdeutige Zieltexte und ungültige Dateipfade. Erhöhe Budgets nur, wenn der Vorschlag dadurch sinnvoll anwendbar wird.

## „Änderungen übernehmen“ ist deaktiviert

Es gibt keine Änderung an der besten Skill-Fassung oder ihren Begleitdateien. Eine geänderte Projektdatei aus einem Agent-Lauf aktiviert den Button nicht: Gespeichert wird der Skill.

Ein ungemessener Entwurf kann dagegen gespeichert werden, wenn sein Bundle geändert wurde. Prüfe den Status und die Diffs im [Ergebnisbericht](/docs/ergebnisse/).

## Create Skill akzeptiert den Zielordner nicht

Der neue Skill-Ordner darf noch nicht existieren. Wähle einen anderen, noch nicht angelegten Pfad. Die App prüft dies vor der Erstellung und erneut beim Übernehmen.

Der Skill-Name muss aus Kleinbuchstaben, Ziffern und einzelnen Bindestrichen zwischen Namensbestandteilen bestehen, beispielsweise `api-tests`.

## Nach dem Neustart fehlt die Trainingsansicht

Die App lädt Formulareinstellungen, stellt aber nicht alle Trainings-Tabs und Laufansichten wieder her. Sitzungsunterlagen bleiben unter `sessions/` im Electron-User-Data-Verzeichnis erhalten. Die [Dateireferenz](/docs/dateien-und-sicherheit/#lokale-sitzungsdaten) beschreibt deren Inhalt.

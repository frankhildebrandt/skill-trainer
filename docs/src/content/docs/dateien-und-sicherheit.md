---
title: Dateien, Kopien und Datenfluss
description: Projektkopien, Skill-Backups, Sitzungsdateien und den Datenfluss zu den Modellanbietern verstehen.
section: Referenz
order: 90
---

Skill Trainer arbeitet mit Projektkopien und speichert den verbesserten Skill erst auf deinen Klick. Die folgenden Grenzen beschreiben das Verhalten der App; sie sind keine Zusage einer vollständigen Betriebssystem-Sandbox.

## Projektkopien

Jeder normale Trainings-, Baseline- und Gate-Lauf erhält eine eigene Kopie des Arbeitsbaums mit einem neu angelegten Git-Repository. Die Kopie ist kein Worktree des ursprünglichen Repositorys. Die App erstellt im ursprünglichen Projekt weder Trainings-Commits noch Projektänderungen.

Bei einem Git-Projekt wird der aktuelle Commit exportiert und um uncommittete Änderungen einschließlich ungetrackter, von Git erfasster Dateien ergänzt. Es handelt sich nicht nur um einen Clone des letzten Commits. Git-ignorierte Dateien werden dadurch nicht generell übernommen.

`node_modules`, `.venv` und `venv` werden, wenn vorhanden, als eigene Verzeichnisse über `cp -cR` kopiert. Sie werden nicht auf die ursprünglichen Abhängigkeiten verlinkt. Andere große generierte Verzeichnisse wie `dist`, `out` oder `coverage` werden beim zusätzlichen Kopieren ausgelassen.

Erfolgreiche und abgebrochene Laufkopien werden aufgeräumt. Fehlgeschlagene Kopien bleiben zur Untersuchung erhalten; die App bietet dann **Kopie öffnen** an.

Bei eingeschaltetem leeren Gate bleiben Trainingsläufe in Projektkopien. Vorprüfung, Baseline und Gates verwenden neue leere Repositories mit Skill und gegebenenfalls Prüfskript.

## Was zum Skill gehört

Eine Auswahl der `SKILL.md` lädt den zugehörigen Skill-Ordner mit. Die App nimmt Textdateien, Binärdateien und die Ausführbarkeit von Dateien auf. Git-Metadaten, Abhängigkeiten, Python-Caches, `.DS_Store` und symbolische Links werden beim Laden des Bundles ausgelassen.

Für die Läufe wird die aktuelle Fassung einschließlich neuer und gelöschter Dateien bereitgestellt. Liegt der Skill innerhalb des Projekts, wird er an seinem ursprünglichen relativen Ort und unter `.cursor/skills/…` platziert. Bei externen Skills verwendet die App den Cursor-Skill-Pfad in der Kopie. Der Text der `SKILL.md` steht zusätzlich direkt im Agent-Prompt.

Projektbezogene Cursor-Settings sind in normalen Projektläufen aktiv; globale Cursor-Settings werden nicht als Quelle geladen. Im leeren Gate werden auch Projekt-Settings deaktiviert. Codex deaktiviert globale Skills und konfigurierte MCP-Server für die Inference-Läufe, ohne die Nutzerkonfiguration dauerhaft zu ändern. Der zu bewertende Skill wird direkt mitgegeben.

## Wann wird der ursprüngliche Skill geändert?

Erst **Änderungen übernehmen** schreibt den besten Skill der Sitzung in den gewählten Zielordner. Bei einem vorhandenen Skill legt die App vorher ein vollständiges Backup daneben ab:

```text
mein-skill/
mein-skill.bak-<Zeitstempel>/
```

Der Speichervorgang bereitet den neuen Ordner zunächst vor und ersetzt dann das Ziel. Verwaltete Dateien, die im Ergebnis gelöscht wurden, werden entfernt. Ausführungsrechte gehören zum gespeicherten Ergebnis. Andere im Ziel vorhandene Dateien werden nicht pauschal entfernt; eine neu erzeugte Skill-Datei darf keine fremde vorhandene Datei überschreiben.

Create Skill akzeptiert nur einen noch nicht vorhandenen Zielordner und erstellt diesen beim Übernehmen. Dafür gibt es keinen alten Ordner als Backup.

## Lokale Sitzungsdaten

Die App legt Sitzungen im Electron-User-Data-Verzeichnis unter `sessions/` ab. **Sitzung öffnen** führt zum genauen Ordner der jeweiligen Sitzung. Dort liegen je nach Workflow unter anderem:

| Datei oder Ordner | Inhalt |
| --- | --- |
| `request.json` | Normalisierte Anfrage einschließlich Pfaden, Auftrag und Einstellungen. |
| `events.jsonl` | Ereignisse und Aktivitätsupdates. |
| `original.md`, `original-skill/` | Ursprünglicher Skill und sein Bundle. |
| `best.md`, `best-skill/` | Beste Fassung der Sitzung. |
| `draft.md`, `draft-skill/` | Vorbereiteter Entwurf bei Vortraining/Create Skill. |
| `summary.json` | Zusammenfassung mit Scores und Anzahl angenommener/verworfener Vorschläge. |
| `checks/` | Vom Agenten vorbereitete Prüfung, falls gewählt. |
| `runs/` | Laufunterlagen und gegebenenfalls erhaltene fehlgeschlagene Kopien. |
| `optimizer/` | Unterlagen der Optimierer-Läufe. |

Das Cursor-SDK speichert außerdem lokale Agent-Unterlagen in `agent-store`-Verzeichnissen im Sitzungsbaum. Formulareinstellungen einschließlich des Inference-Anbieters liegen separat in `settings.json` im User-Data-Verzeichnis. Die App lädt diese beim nächsten Start; sie stellt damit nicht alle geöffneten Laufansichten wieder her.

## Was geht an den Inference-Anbieter?

Die Modellaufrufe laufen je nach gewähltem Anbieter über das Cursor-SDK, den lokalen Codex App Server oder direkt an die eingestellte OpenAI-kompatible API-Basis-URL. Das Zielmodell erhält Auftrag, Prüfbefehl, Skill-Text und Zugriff auf die Dateien der jeweiligen Laufkopie. Inhalte, die es durch Werkzeuge liest, können damit in den Modellkontext gelangen. Der lokale Codex-Unterprozess verwendet den über Codex konfigurierten Modellzugang. Bei OpenAI-kompatiblen Endpunkten bestimmt die Basis-URL, ob die Anfrage einen lokalen Modellserver oder einen entfernten Dienst erreicht. Benötigte API-Schlüssel werden aus der eingestellten Umgebungsvariable gelesen; in den Sitzungsdateien stehen nur URL und Variablenname.

Der Optimierer erhält den aktuellen Skill und die vollständigen Texte seiner Text-Begleitdateien. Dazu kommen zusammengefasste Ausgaben, Diffs und Prüfresultate der Trainingsläufe sowie Informationen zu verworfenen Kandidaten. Binäre Begleitdateien werden als Binärdateien aufgeführt und mitkopiert; ihr Inhalt wird nicht als Text an den Optimierer angehängt.

Beim Fine-Tuning erhalten die Optimierer-Agenten keine Dateiwerkzeuge und sollen ausschließlich Änderungsvorschläge liefern. Für Create Skill und Vortraining lesen sie vorher die ausgewählte Codebase, ohne sie zu verändern. Lokale Sitzungsdateien können Projektinformationen und Agent-Ausgaben enthalten.

## Shell und Ausführungsrechte

Normale Projektagenten verwenden die lokalen Werkzeuge ihrer Anbindung. Die OpenAI-kompatible Anbindung stellt eigene Dateiwerkzeuge und ein Werkzeug für Shell-Befehle bereit. Die App setzt ihr Arbeitsverzeichnis auf die Kopie und weist sie an, nur darin zu arbeiten. Codex verwendet dafür seinen Modus `workspace-write`. Das ist keine eigene Container- oder VM-Grenze.

Im leeren Gate beschränkt die App die Agent-Dateiwerkzeuge auf das Lauf-Repository und stellt dem Zielagenten keine Shell bereit. Bei Codex werden dafür die nativen Umgebungswerkzeuge deaktiviert und kontrollierte Dateiwerkzeuge bereitgestellt. Auch Entwürfe erhalten nur lesende Dateiwerkzeuge; Fine-Tuning-Optimierer und Skill-Analyse erhalten keine Dateiwerkzeuge. Der Trainer führt den Prüfbefehl anschließend dennoch lokal aus.

Eigene oder vom Agenten erzeugte Prüfbefehle laufen mit der Umgebung der App. Ein absoluter Pfad in einem Skript wird nicht automatisch auf die Projektkopie umgeschrieben. Prüfe deshalb die verwendeten Befehle und neue Skill-Skripte wie anderen lokal ausgeführten Code.

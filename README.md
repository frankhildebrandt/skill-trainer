<img src="assets/icon.svg" width="64" height="64" alt="">

# Skill Trainer

Die [Produktseite mit Dokumentation](https://frankhildebrandt.github.io/skill-trainer/) wird mit Astro gebaut. Der Quellcode liegt unter [`docs/`](docs/README.md). Mit Node.js ab 22.23.4 lokal starten:

```bash
npm ci --prefix docs
npm run docs:dev
```

Die Startseite stellt die App mit Screenshots vor. Unter `/skill-trainer/docs/` folgen Einstieg, Workflows, Prüfung, Ergebnisse und eine vollständige Referenz aller Einstellungen und Schalter. `npm run docs:check` prüft die Astro-Dateien; `npm run docs:build` baut die statische Website und prüft ihre internen Links. GitHub Actions prüft Website-Änderungen in Pull Requests und veröffentlicht sie nach einem Push auf `main` automatisch auf GitHub Pages.

Trainiert eine `SKILL.md` gegen einen Projektordner und einen Auftrag. Als Inference-Anbieter stehen Cursor über das Cursor-SDK und Codex über den lokalen Codex App Server zur Auswahl. Die Electron-App verwendet die Anmeldung des gewählten Anbieters.

Das Fine-Tuning folgt [SkillOpt](https://microsoft.github.io/SkillOpt/) von Microsoft Research: der Skill-Ordner ist der trainierbare Zustand, das Modell bleibt fest. Der Optimierer kann die gesamte `SKILL.md` umschreiben, Frontmatter ändern und Referenzen oder Skripte anlegen, ändern und löschen. Eine Fine-Tuning-Fassung wird nur behalten, wenn sie auf frischen Läufen des Hauptauftrags einen höheren Gate-Score hat. Gleichstand zählt als Ablehnung.

## Workflows und Budgets

- **Fine-Tuning:** Einen vorhandenen Skill anhand von Trainingsläufen verbessern und jede Änderung durch das Gate prüfen.
- **Vortraining:** Einen vorhandenen Skill nach einer Beschreibung neu aufbauen oder erweitern, einschließlich seiner Referenzen und Skripte. Optional startet anschließend das Fine-Tuning mit dem Entwurf als Baseline.
- **Create Skill:** Name, Beschreibung und einen neuen Zielordner angeben. Der Optimierer erstellt eine `SKILL.md` mit Frontmatter und die benötigten Begleitdateien. Auch hier kann direkt Fine-Tuning folgen.

Ohne „Anschließend Fine-Tuning“ brauchen Vortraining und Create Skill keinen Trainingsauftrag oder Prüfbefehl. Der Projektordner bleibt erforderlich: der Entwurf liest diese Codebase, bevor er den Skill schreibt, und ändert sie dabei nicht. Der Bericht kennzeichnet das Ergebnis als ungemessenen Entwurf. Vortraining und Erstellung übernehmen den Entwurf ohne Leistungsgate; erst das anschließende Fine-Tuning misst seine Qualität. Ein fertiger Entwurf bleibt auch erhalten, wenn die spätere Vorprüfung fehlschlägt oder das Training abgebrochen wird.

Unter **Budgets** lassen sich Zeichen pro Text-Edit, insgesamt hinzugefügte Zeichen, Anzahl der Dateioperationen und Zeichen pro Dateioperation einstellen. Die Lernrate bestimmt die Zahl der Text-Edits und fällt beim Fine-Tuning über die Schritte. „Optimizer ohne Edit-Budget“ hebt alle diese Grenzen einschließlich der Lernrate auf. Das gilt auch für vollständige Neufassungen der `SKILL.md`, neue Referenzen und ausführbare Skripte. Der Optimierer erhält die vollständigen Texte der Begleitdateien.

Das **Laufbudget** begrenzt die geplante Gesamtzahl aus Trainings-, Baseline-, Gate-, Optimierer- und Testskript-Läufen. Es ist standardmäßig 48, kann erhöht oder mit „Ohne Laufbudget“ aufgehoben werden. Schritte, Batch-Größe und Gate-Wiederholungen haben keine festen kleinen Obergrenzen mehr. Ein Lauf ohne Budget endet weiterhin nach den eingestellten Schritten; die Zeitlimits gelten weiter. Die Schätzung berücksichtigt auch den Entwurfsschritt vor dem Fine-Tuning.

Alle Änderungen bleiben zunächst in der Sitzung. **Änderungen übernehmen** erstellt einen neuen Skill-Ordner oder sichert bei vorhandenen Skills den vollständigen alten Ordner als Backup. Gelöschte Begleitdateien werden dabei entfernt und Ausführungsrechte von Skripten erhalten. Bereits vorhandene Zielordner werden bei Create Skill abgewiesen.

## Schleife

1. Vorprüfung. Der Prüfbefehl muss auf einer frischen Kopie noch fehlschlagen. Sonst kann das Gate einen besseren Skill nicht vom Nichtstun unterscheiden. Wenn der Agent das Testskript schreibt, liegt es unter `.skill-trainer/checks/run.sh`. Nur dieser Ordner wird übernommen und vor jeder Bewertung wiederhergestellt.
2. Baseline. Der aktuelle Skill läuft mehrfach auf dem Hauptauftrag.
3. Training. Weitere Läufe, parallel, jeder in einer eigenen Kopie des Arbeitsbaums. Die Kopie bekommt ein neues Git und ist kein Worktree des Projekts. Der Originalordner wird nur gelesen. Uncommittete Dateien werden mitgenommen. `node_modules`, `.venv` und `venv` werden per `cp -c` kopiert, nicht verlinkt.
4. Reflexion. Fehlschläge und Treffer gehen getrennt an einen zweiten Agenten des gewählten Anbieters. Der schlägt Änderungen am gesamten Skill-Ordner vor. Die eingestellten Budgets gelten, sofern sie nicht aufgehoben wurden.
5. Gate. Dieselben frischen Wiederholungen des Hauptauftrags, mit der Kandidatenfassung. Übernommen nur bei striktem Anstieg.
6. Verworfene Edits bleiben als Negativbeispiel für den nächsten Vorschlag. Ein Slow-Update am Ende darf eine dauerhafte Notiz ergänzen, wieder nur nach Gate. Auch dieser Bereich darf vom Optimierer überarbeitet werden.

Der Gate-Score ist zu 85 % „Prüfbefehl Exit 0“ und zu 15 % „weniger Werkzeugaufrufe“. Ein Fehlschlag schlägt nie einen Treffer. Zwei Treffer unterscheidet, wer weniger recherchieren musste.

Zusätzliche Aufträge (eine Zeile pro Variante) werden nur zum Lernen benutzt. Das Gate sieht immer den Hauptauftrag.

Mit „Gate auf leerem Repository“ laufen Baseline und Gates in einem neuen leeren Git-Repo, das nur den Skill und gegebenenfalls das Prüfskript enthält. Das Training bleibt in Projektkopien. Damit lässt sich ein Modul- oder Add-on-Skill darauf prüfen, ob er ohne den vorhandenen Code auskommt. Der Prüfbefehl muss auf dem leeren Repo rot sein. Im Projekt darf er schon grün sein. Verworfene Gate-Läufe gehen als Negativbeispiel in den nächsten Optimierer-Schritt.

Die Kopien ändern deinen Ordner nicht: kein Worktree, kein Commit und keine Änderung am Arbeitsbaum des Projekts. Fehlgeschlagene Kopien bleiben liegen, damit du sie öffnen kannst. In den Skill-Ordner schreibt die App erst, wenn du auf „Änderungen übernehmen“ klickst, und legt vorher ein Backup daneben.

Ein Skill darf ein Ordner sein: `SKILL.md` plus Skripte, Referenzen und weitere Dateien. Die Auswahl nimmt den Ordner oder die `SKILL.md`; mitkommt der ganze Ordner außer Git-Metadaten, Abhängigkeiten und Caches. Jeder Lauf bekommt die aktuelle Fassung einschließlich neu angelegter und gelöschter Dateien. Text-Edits und Dateioperationen haben getrennt einstellbare Budgets.

Während der Läufe bekommt der Agent den Skill-Text direkt in den Prompt und den Skill-Ordner in der Kopie (`.cursor/skills/…`, plus der ursprüngliche Pfad, wenn der Skill im Projekt liegt). Cursor lädt in normalen Projektläufen Projekt-Settings und keine globalen Settings. Codex deaktiviert globale Skills und konfigurierte MCP-Server für die Inference-Läufe. Im leeren Gate sind bei beiden Anbietern ausschließlich auf die Laufkopie beschränkte Dateiwerkzeuge verfügbar.

## Sprachen

Die Oberfläche unterstützt Deutsch, Englisch, Französisch, Italienisch, Spanisch und Niederländisch. Die Sprachwahl steht oben im Fenster und wirkt sofort, auch in der Lauf-Auswahl. Beim ersten Start wird die erste unterstützte Systemsprache verwendet, andernfalls Englisch. Eine manuell gewählte Sprache bleibt für spätere Starts gespeichert, unabhängig von den Trainingseinstellungen.

Übersetzungen liegen unter `src/shared/i18n/`. Neue Texte bekommen dort einen Schlüssel mit Übersetzungen für alle sechs Sprachen. Datei-, Pfad-, Prüf- und Optimierer-Meldungen verwenden ebenfalls die gewählte Sprache. „Mit Modell füllen“ erstellt neue Ziel- und Auftragstexte in dieser Sprache. Vorhandene Aufträge, Skill-Inhalte und Agent-Antworten behalten ihre Originalsprache.

## Start

Node 22.13 oder neuer.

```bash
npm install
npm test
npm run dev
```

Wenn das Fenster nicht aufgeht, weil der Electron-Download blockiert wurde: `node node_modules/electron/install.js` und danach `npm run dev` noch einmal.

Wähle im Trainingsformular den **Inference-Anbieter**. Die Auswahl gilt für die gesamte Sitzung: Zielmodell, Optimierer, Entwürfe, „Mit Modell füllen“ und die Erstellung des Testskripts. Anmeldung und Modellliste gehören zum ausgewählten Anbieter. Cursor bleibt die Voreinstellung für neue und ältere gespeicherte Konfigurationen.

Für **Cursor** im Fenster „Anmelden“. Das SDK öffnet den Browser und speichert einen User-Key unter `~/.cursor/sdk/auth.json`. Alternativ reicht `CURSOR_API_KEY` in der Umgebung. Die Läufe werden wie andere Cursor-Nutzung abgerechnet.

Für **Codex App Server** muss die [Codex CLI](https://learn.chatgpt.com/docs/cli) ab Version **0.166.0** im `PATH` der App verfügbar und angemeldet sein:

```bash
npm install -g @openai/codex
codex login
codex login status
```

Die App startet `codex app-server --listen stdio://` lokal und verwendet dessen Anmeldung und Modellkatalog. Es ist keine separat gestartete Serverinstanz nötig. Die Modellnutzung erfolgt über dein Codex-Konto beziehungsweise dessen Authentifizierung; ein Cursor-Zugang ist dafür nicht erforderlich. Details zur Anmeldung stehen in der [offiziellen OpenAI-Dokumentation](https://learn.chatgpt.com/docs/auth).

Dann einen Projektordner wählen. Jede `SKILL.md` in diesem Projekt steht als Skill zur Auswahl; gibt es nur eine, ist sie schon ausgewählt. Ein Skill außerhalb des Projekts lässt sich weiter von Hand wählen. Danach Auftrag und Prüfung setzen. **Aus Cursor-Läufen** übernimmt weiterhin ausschließlich Aufträge aus der Cursor-Historie, auch wenn Codex als Inference-Anbieter gewählt ist. Die Prüfung ist wählbar. Entweder gibst du den Testbefehl selbst an, zum Beispiel `npm test` oder `cargo test --quiet`. Oder der Agent schreibt vorher ein Testskript nach `.skill-trainer/checks/run.sh`; der Trainer bewertet danach jeden Lauf damit und stellt das Skript vor der Bewertung wieder her. Der Befehl muss den Auftrag wirklich prüfen, und er muss vor dem Training noch rot sein.

Sitzungen liegen unter dem Electron-User-Data-Ordner in `sessions/`.

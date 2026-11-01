<img src="assets/icon.svg" width="64" height="64" alt="">

# Skill Trainer

Trainiert eine `SKILL.md` gegen einen Projektordner und einen Auftrag. Die Läufe gehen über das Cursor-SDK und damit über dein Cursor-Abo. Electron, weil das SDK in Node läuft.

Das Verfahren folgt [SkillOpt](https://microsoft.github.io/SkillOpt/) von Microsoft Research: das Skill-Dokument ist der trainierbare Zustand, das Modell bleibt fest. Ein Optimierer darf nur kleine Einfüge-, Ersatz- und Lösch-Edits setzen. Eine Fassung wird nur behalten, wenn sie auf frischen Läufen des Hauptauftrags einen höheren Gate-Score hat. Gleichstand zählt als Ablehnung.

## Schleife

1. Vorprüfung. Der Prüfbefehl muss auf einer frischen Kopie noch fehlschlagen. Sonst kann das Gate einen besseren Skill nicht vom Nichtstun unterscheiden. Wenn der Agent das Testskript schreibt, liegt es unter `.skill-trainer/checks/run.sh`. Nur dieser Ordner wird übernommen und vor jeder Bewertung wiederhergestellt.
2. Baseline. Der aktuelle Skill läuft mehrfach auf dem Hauptauftrag.
3. Training. Weitere Läufe, parallel, jeder in einer eigenen Git-Worktree-Kopie. Uncommittete Dateien werden mitgenommen. `node_modules`, `.venv` und `venv` werden per `cp -c` kopiert, nicht verlinkt.
4. Reflexion. Fehlschläge und Treffer gehen getrennt an einen zweiten Cursor-Agenten. Der schlägt begrenzte Edits vor. Die Lernrate fällt über die Schritte (Cosine) und deckelt Anzahl und Länge.
5. Gate. Dieselben frischen Wiederholungen des Hauptauftrags, mit der Kandidatenfassung. Übernommen nur bei striktem Anstieg.
6. Verworfene Edits bleiben als Negativbeispiel für den nächsten Vorschlag. Ein Slow-Update am Ende darf eine kurze dauerhafte Notiz in einen geschützten Block schreiben, wieder nur nach Gate.

Der Gate-Score ist zu 85 % „Prüfbefehl Exit 0“ und zu 15 % „weniger Werkzeugaufrufe“. Ein Fehlschlag schlägt nie einen Treffer. Zwei Treffer unterscheidet, wer weniger recherchieren musste.

Zusätzliche Aufträge (eine Zeile pro Variante) werden nur zum Lernen benutzt. Das Gate sieht immer den Hauptauftrag.

Mit „Gate auf leerem Repository“ bleibt das Training im Projektordner, und Baseline plus Gate laufen in einem neuen leeren Git-Repo, das nur den Skill enthält. Damit lässt sich ein Modul- oder Add-on-Skill darauf prüfen, ob er ohne den vorhandenen Code auskommt. Der Prüfbefehl muss auf dem leeren Repo rot sein. Im Projekt darf er schon grün sein. Verworfene Gate-Läufe gehen als Negativbeispiel in den nächsten Optimierer-Schritt.

Die Wegwerfkopien ändern deinen Ordner nicht. Fehlgeschlagene Kopien bleiben liegen, damit du sie öffnen kannst. In die `SKILL.md` schreibt die App erst, wenn du auf „In die SKILL.md schreiben“ klickst, und legt vorher ein Backup daneben.

Ein Skill darf ein Ordner sein: `SKILL.md` plus Skripte, Referenzen und weitere Dateien. Die Auswahl nimmt den Ordner oder die `SKILL.md`; mitkommt immer der ganze Ordner. Jeder Lauf bekommt diese Dateien, und der Optimierer darf sie im selben Edit-Budget ändern. „In den Skill-Ordner schreiben“ legt ein Backup des Ordners daneben und schreibt die übernommene Fassung zurück.

Während der Läufe bekommt der Agent den Skill-Text direkt in den Prompt und den Skill-Ordner in der Kopie (`.cursor/skills/…`, plus der ursprüngliche Pfad, wenn der Skill im Projekt liegt). Projekt-Settings sind an, globale Skills aus, damit nicht eine ältere Nutzerfassung mitmisst.

## Start

Node 22.13 oder neuer.

```bash
npm install
npm test
npm run dev
```

Wenn das Fenster nicht aufgeht, weil der Electron-Download blockiert wurde: `node node_modules/electron/install.js` und danach `npm run dev` noch einmal.

Im Fenster „Mit Cursor anmelden“. Das SDK öffnet den Browser und speichert einen User-Key unter `~/.cursor/sdk/auth.json`. Alternativ reicht `CURSOR_API_KEY` in der Umgebung. Die Läufe werden wie andere Cursor-Nutzung abgerechnet.

Dann Skill, Ordner und Auftrag setzen. Die Prüfung ist wählbar. Entweder gibst du den Testbefehl selbst an, zum Beispiel `npm test` oder `cargo test --quiet`. Oder der Agent schreibt vorher ein Testskript nach `.skill-trainer/checks/run.sh`; der Trainer bewertet danach jeden Lauf damit und stellt das Skript vor der Bewertung wieder her. Der Befehl muss den Auftrag wirklich prüfen, und er muss vor dem Training noch rot sein.

Sitzungen liegen unter dem Electron-User-Data-Ordner in `sessions/`.

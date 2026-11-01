---
title: So arbeitet das Training
description: Vorprüfung, Baseline, Optimierung und Gate nachvollziehen.
section: Anwendung
order: 50
---

Fine-Tuning verändert den Skill-Ordner. Das gewählte Zielmodell bleibt während des Trainings gleich. Die App vergleicht aufeinanderfolgende Skill-Fassungen durch neue Läufe und einen extern ausgeführten Test.

## 1. Vorprüfung

Die App führt den Prüfbefehl auf einer frischen Ausgangskopie aus, bevor das Zielmodell den Auftrag bearbeitet. Der Test muss fehlschlagen. Besteht er bereits, stoppt das Training: Dann könnte derselbe Test auch Nichtstun als Erfolg werten.

Wenn du **Agent schreibt das Testskript** gewählt hast, erstellt das Zielmodell die Prüfung vor dieser Vorprüfung. Bei Vortraining/Create Skill wird zuerst der Entwurf vorbereitet.

## 2. Baseline

Der aktuelle Skill bearbeitet den Hauptauftrag in mehreren frischen Läufen. **Gate** legt die Anzahl dieser Wiederholungen fest. Ihr gemittelter Score wird zur Baseline.

## 3. Trainingsläufe

Pro Schritt startet die App so viele Trainingsläufe wie unter **Training** angegeben. **Parallel** begrenzt, wie viele davon gleichzeitig laufen. Jeder Lauf erhält eine eigene Kopie des Projekts und die aktuelle Fassung des ganzen Skill-Ordners.

Sind **Weitere Aufträge** vorhanden, verwendet das Training diese Varianten zyklisch als Aufgaben-Pool. Ohne Varianten verwendet es den Hauptauftrag. Baseline und Gate bleiben immer beim Hauptauftrag.

## 4. Optimierer

Der Optimierer erhält den Skill, die Texte seiner Begleitdateien sowie Treffer, Fehler, Ausgaben und Diffs aus den Trainingsläufen. Verworfene Vorschläge und ausgewählte fehlgeschlagene Gate-Läufe dienen als zusätzliche Gegenbeispiele.

Er schlägt Text-Edits und Dateioperationen vor. Damit kann er auch `SKILL.md` vollständig neu schreiben, Frontmatter ändern oder Referenzen und Skripte ergänzen, ändern oder löschen. Die App wendet nur gültige Änderungen innerhalb der eingestellten Budgets an.

Die **Lernrate** begrenzt Text-Edits und sinkt über die Schritte bis auf 1. Dateioperationen haben separate Grenzen. Wenn keine Änderung angewendet werden kann, wird das Gate dieses Schritts übersprungen.

## 5. Gate

Die Kandidatenfassung bearbeitet den Hauptauftrag in neuen Läufen. Ihr mittlerer Score muss **strikt höher** sein als der Score der bisherigen besten Fassung. Bei Gleichstand oder Verschlechterung bleibt die bisherige Fassung erhalten.

Die frischen Gate-Läufe sind eigene Ausführungen; sie verwenden denselben Hauptauftrag wie die Baseline. Zusätzliche Trainingsaufträge werden dort nicht bewertet.

## 6. Slow-Update

Mit eingeschaltetem **Slow-Update** folgt nach den regulären Schritten ein weiterer Optimierer-Vorschlag. Er kann eine dauerhafte Lernnotiz im Skill ergänzen sowie weitere Änderungen vorschlagen. Auch dieser Kandidat muss das Gate verbessern. Eine Notiz wird nicht allein deshalb behalten, weil sie plausibel klingt.

## Wie der Score entsteht

Ein Lauf erhält 85 % Gewicht für **Prüfbefehl mit Exit 0** und 15 % für Effizienz anhand der Werkzeugaufrufe. Fehlgeschlagene Läufe erhalten 0 Punkte. Bei erfolgreichen Läufen gilt:

```text
Effizienz = 1 / (1 + Werkzeugaufrufe / 8)
Gate-Score = 0,85 × Erfolg + 0,15 × Effizienz
```

Der angezeigte Gate-Score ist der Mittelwert der Wiederholungen. Er ist keine reine Erfolgsquote: Auch bei lauter erfolgreichen Läufen kann er unter 100 % liegen. Der Bericht nennt deshalb zusätzlich die Zahl grüner Läufe.

## Gate auf leerem Repository

Mit diesem Schalter laufen **Vorprüfung, Baseline und Gates** in neuen leeren Git-Repositories. Enthalten sind dort der Skill und gegebenenfalls das erzeugte Prüfskript. **Die Trainingsläufe laufen weiterhin in Projektkopien.**

Das hilft etwa bei einem Skill, der ein Modul oder Add-on ohne vorhandenen Projektcode erzeugen soll. Der Test muss im leeren Repo fehlschlagen und dort ausführbar sein. Projektdateien, Projekt-Settings und Abhängigkeiten aus dem Trainingsprojekt stehen dem Gate nicht zur Verfügung.

Die Zielagenten im leeren Repo erhalten auf dieses Repo beschränkte Dateiwerkzeuge und keine Shell. Der Trainer selbst führt anschließend den Prüfbefehl aus. Ein Skill für dieses Gate muss daher die nötigen Informationen und Dateien mitbringen; er kann keine Installation per Agent-Shell voraussetzen.

Wie du das Resultat bewertest und speicherst, erklärt [Ergebnisse](/docs/ergebnisse/).

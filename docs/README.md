# Skill Trainer · Produktseite und Dokumentation

Eigenständige, statisch gebaute Astro-Seite auf Deutsch. Die [Marketing-Landingpage](https://frankhildebrandt.github.io/skill-trainer/) stellt die App vor; die [Dokumentation](https://frankhildebrandt.github.io/skill-trainer/docs/) enthält Anleitungen, Referenz und eine lokale Volltextsuche. Die Electron-App benötigt die Website nicht.

## Lokal starten

Für die Website benötigst du **Node.js ab 22.23.4**. Im Repository-Stamm:

```sh
npm ci --prefix docs
npm run docs:dev
```

Astro zeigt die lokale Adresse an, normalerweise `http://127.0.0.1:4321/skill-trainer/`. Lokal gilt derselbe Basispfad wie auf GitHub Pages.

## Prüfen und bauen

```sh
npm run docs:check
npm run docs:build
npm run docs:preview
```

Der Build erzeugt `docs/dist/` und prüft anschließend alle internen Links, Sprungmarken, eingebundenen Dateien und den Suchindex. `site` und `base` in `astro.config.mjs` konfigurieren die GitHub-Pages-Adresse. Navigation, Assets und Markdown-Links berücksichtigen den Basispfad automatisch. Für eine eigene Domain können `site` und `base` angepasst werden; für die Domain-Wurzel gilt `base: "/"`.

Die lokalen Befehle veröffentlichen die Website nicht. Die Electron-App selbst verlangt Node.js ab 22.13; die Astro-Website benötigt die oben genannte neuere Version.

## GitHub Pages

Der Workflow [`.github/workflows/docs.yml`](../.github/workflows/docs.yml) installiert ausschließlich die Website-Abhängigkeiten mit `npm ci` und verwendet Node.js 24. Pull Requests auf `main` werden mit Astro-Check, statischem Build und Link-Prüfung geprüft. Änderungen unter `docs/` oder am Workflow werden nach einem Push auf `main` automatisch veröffentlicht. Unter **Actions → Documentation → Run workflow** kann der Build auch manuell gestartet werden; nur `main` darf veröffentlichen.

Unter **Settings → Pages → Build and deployment → Source** muss **GitHub Actions** aktiviert sein. Die Veröffentlichung verwendet das Environment `github-pages` und die temporären GitHub-Actions-Berechtigungen; zusätzliche Secrets oder ein `gh-pages`-Branch sind nicht nötig.

Deployment-Ziel: **https://frankhildebrandt.github.io/skill-trainer/**. Hintergrund: [Astro-Anleitung für GitHub Pages](https://docs.astro.build/en/guides/deploy/github/) und [eigene Pages-Workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Inhalte bearbeiten

- `src/pages/index.astro`: Produktseite mit App-Screenshots und Einstieg in die Doku.
- `src/content/docs/*.md`: Anleitungen und Referenz, mit `title`, `description`, `section` und `order` im Frontmatter.
- `src/content.config.ts`: Validierung der Inhalte. Erlaubte Bereiche: `Start`, `Anwendung`, `Referenz`.
- `src/layouts/` und `src/styles/`: gemeinsame Gestaltung, Dokumentationsnavigation und Inhaltsverzeichnis.
- `src/pages/search-index.json.ts`: Suchindex aus sämtlichen Dokumentationsseiten; ohne externen Suchdienst.
- `public/screenshots/`: eingecheckte App-Aufnahmen.

Für eine weitere Doku-Seite genügt eine Markdown-Datei mit passendem Frontmatter. Navigation, Suche, Inhaltsverzeichnis und Vor-/Zurück-Links werden automatisch erzeugt.

## Screenshots aktualisieren

```sh
npm ci
npm run docs:screenshots
```

Das Aufnahmeskript rendert die originalen React-Komponenten der App in Electron mit einer separaten Demo-Fixture. Es startet keine Cursor-Läufe, liest keine Anmeldung und schreibt keine echten Skills. Die Bilder zeigen ausdrücklich Beispieldaten; Zahlen sind keine gemessenen Produktversprechen. Für die Aufnahme wird eine installierte Electron-Binärdatei benötigt, für einen normalen Website-Build genügen die eingecheckten PNGs.

## Technische Grundlage

Die Inhalte verwenden Astros aktuelle [Content Collections](https://docs.astro.build/de/guides/content-collections/) mit `glob()`-Loader und statisch erzeugten Routen. Die Suche lädt den Index erst bei Bedarf. Navigation, Artikel und FAQ sind auch ohne JavaScript nutzbar.

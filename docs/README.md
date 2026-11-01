# Skill Trainer · Produktseite und Dokumentation

Eigenständige, statisch gebaute Astro-Seite auf Deutsch. `/` stellt die App vor; `/docs/` enthält die Bedienungsdokumentation und eine lokale Volltextsuche. Die Electron-App benötigt die Website nicht.

## Lokal starten

Für die Website benötigst du **Node.js ab 22.23.4**. Im Repository-Stamm:

```sh
npm ci --prefix docs
npm run docs:dev
```

Astro zeigt die lokale Adresse an, normalerweise `http://127.0.0.1:4321`.

## Prüfen und bauen

```sh
npm run docs:check
npm run docs:build
npm run docs:preview
```

Der Build erzeugt `docs/dist/` und prüft anschließend alle internen Links, Sprungmarken und eingebundenen Dateien. Das Verzeichnis kann auf einem beliebigen statischen Host unter dessen Domain-Wurzel veröffentlicht werden. Es werden weder ein Server-Adapter noch Zugangsdaten benötigt. Für ein Hosting in einem Unterverzeichnis müssen vorab die absoluten Links und Asset-Pfade sowie Astros `base` angepasst werden.

Die Website wird durch diese Befehle nicht veröffentlicht. Die Electron-App selbst verlangt Node.js ab 22.13; die aktuelle Astro-Version für diese Website benötigt die oben genannte neuere Version.

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

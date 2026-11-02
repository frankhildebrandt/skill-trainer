import type { Translations } from "./types";

const de = {
  "codex.notInstalled": "Codex CLI wurde nicht gefunden. Installiere Codex und starte die App erneut.",
  "codex.unsupportedVersion": "Codex CLI ab Version 0.166.0 ist erforderlich. Aktualisiere Codex und starte die App erneut.",
  "codex.loginFailed": "Die Anmeldung bei Codex ist fehlgeschlagen. Versuche es erneut oder nutze codex login im Terminal.",
  "codex.loginTimeout": "Die Codex-Anmeldung hat das Zeitlimit überschritten. Versuche es erneut.",
  "codex.invalidCatalog": "Codex hat eine ungültige Modellliste geliefert.",
};

export const codexMessages = {
  de,
  en: {
    "codex.notInstalled": "Codex CLI was not found. Install Codex and restart the app.",
    "codex.unsupportedVersion": "Codex CLI version 0.166.0 or newer is required. Update Codex and restart the app.",
    "codex.loginFailed": "Codex sign-in failed. Try again or run codex login in a terminal.",
    "codex.loginTimeout": "Codex sign-in timed out. Try again.",
    "codex.invalidCatalog": "Codex returned an invalid model catalog.",
  },
  fr: {
    "codex.notInstalled": "Le CLI Codex est introuvable. Installez Codex et redémarrez l’application.",
    "codex.unsupportedVersion": "Le CLI Codex version 0.166.0 ou ultérieure est requis. Mettez Codex à jour et redémarrez l’application.",
    "codex.loginFailed": "La connexion à Codex a échoué. Réessayez ou lancez codex login dans un terminal.",
    "codex.loginTimeout": "Le délai de connexion à Codex est dépassé. Réessayez.",
    "codex.invalidCatalog": "Codex a renvoyé une liste de modèles invalide.",
  },
  it: {
    "codex.notInstalled": "Il CLI Codex non è stato trovato. Installa Codex e riavvia l’app.",
    "codex.unsupportedVersion": "È richiesto il CLI Codex versione 0.166.0 o successiva. Aggiorna Codex e riavvia l’app.",
    "codex.loginFailed": "L’accesso a Codex non è riuscito. Riprova o esegui codex login in un terminale.",
    "codex.loginTimeout": "Il tempo per l’accesso a Codex è scaduto. Riprova.",
    "codex.invalidCatalog": "Codex ha restituito un elenco di modelli non valido.",
  },
  es: {
    "codex.notInstalled": "No se ha encontrado el CLI de Codex. Instala Codex y reinicia la aplicación.",
    "codex.unsupportedVersion": "Se requiere el CLI de Codex versión 0.166.0 o posterior. Actualiza Codex y reinicia la aplicación.",
    "codex.loginFailed": "El inicio de sesión en Codex ha fallado. Inténtalo de nuevo o ejecuta codex login en un terminal.",
    "codex.loginTimeout": "El inicio de sesión en Codex ha superado el tiempo límite. Inténtalo de nuevo.",
    "codex.invalidCatalog": "Codex ha devuelto una lista de modelos no válida.",
  },
  nl: {
    "codex.notInstalled": "Codex CLI is niet gevonden. Installeer Codex en start de app opnieuw.",
    "codex.unsupportedVersion": "Codex CLI versie 0.166.0 of nieuwer is vereist. Werk Codex bij en start de app opnieuw.",
    "codex.loginFailed": "Aanmelden bij Codex is mislukt. Probeer opnieuw of voer codex login uit in een terminal.",
    "codex.loginTimeout": "De aanmelding bij Codex heeft de tijdslimiet bereikt. Probeer opnieuw.",
    "codex.invalidCatalog": "Codex heeft een ongeldige modellenlijst teruggegeven.",
  },
} satisfies Translations<typeof de>;

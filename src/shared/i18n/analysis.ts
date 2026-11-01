import type { Translations } from "./types";

const de = {
  "analysis.responseNotObject": "Die Antwort ist kein Objekt.",
  "analysis.missingFields": "Ziel oder Auftrag fehlt in der Antwort.",
  "analysis.incompleteJson": "Die Antwort enthält kein vollständiges JSON-Objekt.",
};

export const analysisMessages = {
  de,
  en: {
    "analysis.responseNotObject": "The response is not an object.",
    "analysis.missingFields": "The response is missing the goal or assignment.",
    "analysis.incompleteJson": "The response does not contain a complete JSON object.",
  },
  fr: {
    "analysis.responseNotObject": "La réponse n’est pas un objet.",
    "analysis.missingFields": "L’objectif ou la tâche manque dans la réponse.",
    "analysis.incompleteJson": "La réponse ne contient pas d’objet JSON complet.",
  },
  it: {
    "analysis.responseNotObject": "La risposta non è un oggetto.",
    "analysis.missingFields": "Nella risposta manca l’obiettivo o il compito.",
    "analysis.incompleteJson": "La risposta non contiene un oggetto JSON completo.",
  },
  es: {
    "analysis.responseNotObject": "La respuesta no es un objeto.",
    "analysis.missingFields": "Falta el objetivo o la tarea en la respuesta.",
    "analysis.incompleteJson": "La respuesta no contiene un objeto JSON completo.",
  },
  nl: {
    "analysis.responseNotObject": "Het antwoord is geen object.",
    "analysis.missingFields": "Het doel of de opdracht ontbreekt in het antwoord.",
    "analysis.incompleteJson": "Het antwoord bevat geen volledig JSON-object.",
  },
} satisfies Translations<typeof de>;

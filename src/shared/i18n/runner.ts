import type { Translations } from "./types";

const de = {
  "runner.retryConnection": "Verbindung stockt, neuer Versuch.",
  "runner.retryProposal": "Zweiter Versuch im selben Lauf. {reason}",
  "runner.proposalComplete": "Der Vorschlag ist vollständig. Dieser Durchlauf endet hier, damit keine weitere Überlegung im selben Lauf startet.",
  "runner.cancelled": "Optimierer abgebrochen",
  "runner.failed": "Optimierer-Lauf ist fehlgeschlagen.",
  "runner.noUsableProposal": "Die erste Antwort enthielt keinen verwertbaren Vorschlag.",
  "runner.notProposal": "Die erste Antwort war kein Vorschlag.",
  "runner.gitFailed": "git {command} ist fehlgeschlagen ({code})"
};

export const runnerMessages = {
 de,
 en: {
  "runner.retryConnection": "Connection stalled. Retrying.",
  "runner.retryProposal": "Second attempt in the same run. {reason}",
  "runner.proposalComplete": "The proposal is complete. This run ends here to prevent further reasoning in the same run.",
  "runner.cancelled": "Optimizer cancelled",
  "runner.failed": "Optimizer run failed.",
  "runner.noUsableProposal": "The first response did not contain a usable proposal.",
  "runner.notProposal": "The first response was not a proposal.",
  "runner.gitFailed": "git {command} failed ({code})"
},
fr: {
  "runner.retryConnection": "La connexion est bloquée. Nouvelle tentative.",
  "runner.retryProposal": "Deuxième tentative dans la même exécution. {reason}",
  "runner.proposalComplete": "La proposition est complète. Cette exécution s’arrête ici pour éviter un nouveau raisonnement dans la même exécution.",
  "runner.cancelled": "Optimiseur annulé",
  "runner.failed": "L’exécution de l’optimiseur a échoué.",
  "runner.noUsableProposal": "La première réponse ne contenait aucune proposition utilisable.",
  "runner.notProposal": "La première réponse n’était pas une proposition.",
  "runner.gitFailed": "git {command} a échoué ({code})"
},
it: {
  "runner.retryConnection": "Connessione bloccata. Nuovo tentativo.",
  "runner.retryProposal": "Secondo tentativo nella stessa esecuzione. {reason}",
  "runner.proposalComplete": "La proposta è completa. Questa esecuzione termina qui per evitare ulteriori ragionamenti nella stessa esecuzione.",
  "runner.cancelled": "Ottimizzatore annullato",
  "runner.failed": "L’esecuzione dell’ottimizzatore è fallita.",
  "runner.noUsableProposal": "La prima risposta non conteneva una proposta utilizzabile.",
  "runner.notProposal": "La prima risposta non era una proposta.",
  "runner.gitFailed": "git {command} è fallito ({code})"
},
es: {
  "runner.retryConnection": "La conexión se ha bloqueado. Reintentando.",
  "runner.retryProposal": "Segundo intento en la misma ejecución. {reason}",
  "runner.proposalComplete": "La propuesta está completa. Esta ejecución termina aquí para evitar más razonamiento en la misma ejecución.",
  "runner.cancelled": "Optimizador cancelado",
  "runner.failed": "La ejecución del optimizador ha fallado.",
  "runner.noUsableProposal": "La primera respuesta no contenía una propuesta utilizable.",
  "runner.notProposal": "La primera respuesta no era una propuesta.",
  "runner.gitFailed": "git {command} ha fallado ({code})"
},
nl: {
  "runner.retryConnection": "Verbinding vastgelopen. Opnieuw proberen.",
  "runner.retryProposal": "Tweede poging in dezelfde uitvoering. {reason}",
  "runner.proposalComplete": "Het voorstel is compleet. Deze uitvoering stopt hier om verder redeneren in dezelfde uitvoering te voorkomen.",
  "runner.cancelled": "Optimalisatie geannuleerd",
  "runner.failed": "Optimalisatie is mislukt.",
  "runner.noUsableProposal": "Het eerste antwoord bevatte geen bruikbaar voorstel.",
  "runner.notProposal": "Het eerste antwoord was geen voorstel.",
  "runner.gitFailed": "git {command} is mislukt ({code})"
}
} satisfies Translations<typeof de>;

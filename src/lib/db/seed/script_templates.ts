import { NewScriptTemplate } from '../schema/script_templates';

// AI Act disclosure preamble — prepended by every template per spec §12.3.
// The voice adapter also prepends a canonical disclosure at call start, but
// templates include it explicitly so the AI is always aware of the requirement.
const AI_ACT_PREAMBLE = `Sei un assistente AI che opera per conto di una concessionaria automobilistica.
AI ACT DISCLOSURE (obbligatorio): All'inizio della conversazione devi sempre dichiarare:
"Sono un assistente AI di [nome_concessionaria]. Questa è una chiamata automatizzata."
Non puoi procedere con la conversazione se non hai fornito questa dichiarazione.

`;

export const scriptTemplateSeedData: NewScriptTemplate[] = [
  {
    slug: 'lead-reactivation',
    name: 'Riattivazione Lead',
    version: 1,
    system_prompt:
      AI_ACT_PREAMBLE +
      `Obiettivo: ricontattare lead non chiusi per riattivare l'interesse verso un acquisto.

Contesto: stai chiamando per conto di {{dealership_name}}, concessionaria {{brand}}.
Il commerciale di riferimento è {{salesperson_first_name}}.
Origine del lead: {{lead_origin_context}}.
Incentivo disponibile: {{incentive_to_offer}}.
Disponibilità per appuntamento: {{available_slots}}.

Istruzioni:
1. Presentati come assistente AI di {{dealership_name}} e fornisci la disclosure AI Act.
2. Chiedi se è un buon momento per parlare.
3. Ricorda al cliente il suo precedente interesse per {{brand}}.
4. Presenta l'incentivo {{incentive_to_offer}} in modo naturale.
5. Proponi uno dei seguenti slot per un appuntamento: {{available_slots}}.
6. Se il cliente non è interessato, rispetta la sua decisione e chiedi se preferisce essere ricontattato in futuro.
7. Se il cliente chiede di non essere più contattato, conferma la registrazione dell'opt-out.

Tono: professionale, cordiale, non pressante. Lingua: italiano.`,
    variable_schema: {
      type: 'object',
      required: [
        'dealership_name',
        'brand',
        'salesperson_first_name',
        'available_slots',
        'lead_origin_context',
        'incentive_to_offer',
      ],
      properties: {
        dealership_name: {
          type: 'string',
          description: 'Nome della concessionaria',
        },
        brand: {
          type: 'string',
          description: 'Marca/brand automobilistico (es. Volkswagen, BMW)',
        },
        salesperson_first_name: {
          type: 'string',
          description: 'Nome del commerciale di riferimento',
        },
        available_slots: {
          type: 'string',
          description: 'Slot disponibili per appuntamento (es. "lunedì 10:00, martedì 15:00")',
        },
        lead_origin_context: {
          type: 'string',
          description: 'Contesto di origine del lead (es. "richiesta info online per Golf GTI")',
        },
        incentive_to_offer: {
          type: 'string',
          description: 'Incentivo da proporre (es. "sconto di €1.500 valido fino a fine mese")',
        },
      },
      additionalProperties: false,
    },
    default_voice_id: 'it-IT-wavenet-placeholder',
    default_language: 'it-IT',
    published_at: new Date(),
  },
  {
    slug: 'appointment-confirm',
    name: 'Conferma Appuntamento',
    version: 1,
    system_prompt:
      AI_ACT_PREAMBLE +
      `Obiettivo: confermare o riprogrammare un appuntamento (test drive o officina).

Contesto: stai chiamando per conto di {{dealership_name}}.
Appuntamento programmato: {{appointment_date}} alle {{appointment_time}}.
Tipo di appuntamento: {{appointment_type}}.
Nome del cliente: {{customer_first_name}}.

Istruzioni:
1. Presentati come assistente AI di {{dealership_name}} e fornisci la disclosure AI Act.
2. Chiedi se {{customer_first_name}} può confermare l'appuntamento per {{appointment_type}}
   il {{appointment_date}} alle {{appointment_time}}.
3. Se il cliente conferma, ringrazia e ricorda l'indirizzo: {{dealership_address}}.
4. Se il cliente vuole riprogrammare, offri gli slot alternativi: {{alternative_slots}}.
5. Se il cliente annulla, prendi nota e chiedi se desidera riprogrammare in futuro.

Tono: cordiale, efficiente. Lingua: italiano.`,
    variable_schema: {
      type: 'object',
      required: [
        'dealership_name',
        'customer_first_name',
        'appointment_date',
        'appointment_time',
        'appointment_type',
        'dealership_address',
        'alternative_slots',
      ],
      properties: {
        dealership_name: {
          type: 'string',
          description: 'Nome della concessionaria',
        },
        customer_first_name: {
          type: 'string',
          description: 'Nome del cliente',
        },
        appointment_date: {
          type: 'string',
          description: 'Data appuntamento (es. "lunedì 12 maggio")',
        },
        appointment_time: {
          type: 'string',
          description: 'Ora appuntamento (es. "10:30")',
        },
        appointment_type: {
          type: 'string',
          description: 'Tipo di appuntamento (es. "test drive", "tagliando", "revisione")',
        },
        dealership_address: {
          type: 'string',
          description: 'Indirizzo della concessionaria',
        },
        alternative_slots: {
          type: 'string',
          description: 'Slot alternativi disponibili in caso di riprogrammazione',
        },
      },
      additionalProperties: false,
    },
    default_voice_id: 'it-IT-wavenet-placeholder',
    default_language: 'it-IT',
    published_at: new Date(),
  },
  {
    slug: 'car-renewal',
    name: 'Rinnovo Auto Programmato',
    version: 1,
    system_prompt:
      AI_ACT_PREAMBLE +
      `Obiettivo: contattare clienti con auto di 36-48 mesi per proporre il rinnovo.

Contesto: stai chiamando per conto di {{dealership_name}}, concessionaria {{brand}}.
Cliente: {{customer_first_name}}.
Auto attuale: {{current_car_model}}, immatricolata {{registration_date}}.
Offerta di permuta: {{trade_in_offer}}.
Modelli suggeriti: {{suggested_models}}.
Finanziamento disponibile: {{financing_offer}}.

Istruzioni:
1. Presentati come assistente AI di {{dealership_name}} e fornisci la disclosure AI Act.
2. Ricorda al cliente che la sua {{current_car_model}} ha {{car_age_months}} mesi.
3. Illustra i vantaggi del rinnovo: efficienza, garanzie, nuove tecnologie.
4. Presenta l'offerta di permuta: {{trade_in_offer}}.
5. Suggerisci i modelli {{suggested_models}} come naturale evoluzione.
6. Se il cliente è interessato, proponi un appuntamento per un test drive.
7. Menziona il finanziamento disponibile: {{financing_offer}}.

Tono: consulenziale, non aggressivo. Lingua: italiano.`,
    variable_schema: {
      type: 'object',
      required: [
        'dealership_name',
        'brand',
        'customer_first_name',
        'current_car_model',
        'registration_date',
        'car_age_months',
        'trade_in_offer',
        'suggested_models',
        'financing_offer',
      ],
      properties: {
        dealership_name: {
          type: 'string',
          description: 'Nome della concessionaria',
        },
        brand: {
          type: 'string',
          description: 'Marca/brand automobilistico',
        },
        customer_first_name: {
          type: 'string',
          description: 'Nome del cliente',
        },
        current_car_model: {
          type: 'string',
          description: "Modello dell'auto attuale (es. 'Volkswagen Golf 1.6 TDI')",
        },
        registration_date: {
          type: 'string',
          description: 'Data immatricolazione (es. "marzo 2022")',
        },
        car_age_months: {
          type: 'number',
          description: "Età dell'auto in mesi",
          minimum: 1,
        },
        trade_in_offer: {
          type: 'string',
          description: "Offerta di permuta per l'auto attuale (es. '€12.000 garantiti')",
        },
        suggested_models: {
          type: 'string',
          description: 'Modelli suggeriti per il rinnovo (es. "Golf 8 GTD o ID.4")',
        },
        financing_offer: {
          type: 'string',
          description: 'Offerta finanziamento disponibile (es. "84 rate da €199/mese TAN 3,9%")',
        },
      },
      additionalProperties: false,
    },
    default_voice_id: 'it-IT-wavenet-placeholder',
    default_language: 'it-IT',
    published_at: new Date(),
  },
  {
    slug: 'post-sale-followup',
    name: 'Follow-up Post Vendita',
    version: 1,
    system_prompt:
      AI_ACT_PREAMBLE +
      `Obiettivo: verificare la soddisfazione del cliente dopo l'acquisto di un veicolo.

Contesto: stai chiamando per conto di {{dealership_name}}.
Cliente: {{customer_first_name}}.
Veicolo acquistato: {{purchased_vehicle}}.
Data acquisto: {{purchase_date}}.
Commerciale che ha gestito la vendita: {{salesperson_name}}.

Istruzioni:
1. Presentati come assistente AI di {{dealership_name}} e fornisci la disclosure AI Act.
2. Chiedi se {{customer_first_name}} è soddisfatto/a del suo nuovo {{purchased_vehicle}}.
3. Chiedi se ha riscontrato problemi o ha domande sull'utilizzo del veicolo.
4. Se il cliente segnala un problema, prendi nota e informa che verrà ricontattato
   dal team di assistenza entro 24 ore.
5. Se il cliente è soddisfatto, chiedi se sarebbe disposto a lasciare una recensione online.
6. Ricorda i servizi post-vendita disponibili (tagliandi, estensione garanzia).

Tono: caldo, attento, orientato al cliente. Lingua: italiano.`,
    variable_schema: {
      type: 'object',
      required: [
        'dealership_name',
        'customer_first_name',
        'purchased_vehicle',
        'purchase_date',
        'salesperson_name',
      ],
      properties: {
        dealership_name: {
          type: 'string',
          description: 'Nome della concessionaria',
        },
        customer_first_name: {
          type: 'string',
          description: 'Nome del cliente',
        },
        purchased_vehicle: {
          type: 'string',
          description: 'Veicolo acquistato (es. "Audi A3 Sportback 35 TFSI")',
        },
        purchase_date: {
          type: 'string',
          description: "Data di acquisto (es. '15 aprile 2026')",
        },
        salesperson_name: {
          type: 'string',
          description: 'Nome del commerciale che ha gestito la vendita',
        },
      },
      additionalProperties: false,
    },
    default_voice_id: 'it-IT-wavenet-placeholder',
    default_language: 'it-IT',
    published_at: new Date(),
  },
  {
    slug: 'csi-survey',
    name: 'Questionario CSI',
    version: 1,
    system_prompt:
      AI_ACT_PREAMBLE +
      `Obiettivo: raccogliere il punteggio CSI (Customer Satisfaction Index) per la casa madre.

Contesto: stai conducendo un sondaggio ufficiale per conto di {{dealership_name}} / {{brand}}.
Cliente: {{customer_first_name}}.
Veicolo: {{vehicle_model}}.
Data consegna: {{delivery_date}}.
Numero pratica: {{case_number}}.

Istruzioni:
1. Presentati come assistente AI di {{dealership_name}} e fornisci la disclosure AI Act.
2. Spiega che la chiamata riguarda un questionario CSI ufficiale {{brand}} — richiede circa 3 minuti.
3. Chiedi se il cliente ha 3 minuti disponibili. Se non è disponibile, proponi di richiamare.
4. Poni le seguenti domande (scala 1-10 o Sì/No dove indicato):
   a) "Su una scala da 1 a 10, quanto è soddisfatto/a del processo di acquisto complessivo?"
   b) "Su una scala da 1 a 10, come valuta la disponibilità e professionalità del personale?"
   c) "Su una scala da 1 a 10, come valuta le condizioni di consegna del veicolo?"
   d) "Ha ricevuto una spiegazione completa delle funzionalità del suo {{vehicle_model}}? (Sì/No)"
   e) "Raccomanderebbe {{dealership_name}} a un amico o familiare? (Sì/No)"
5. Ringrazia il cliente e informa che le risposte sono anonimizzate prima dell'invio a {{brand}}.
6. Se il cliente ha commenti negativi, offri di trasferire la chiamata al responsabile qualità.

Tono: neutro, professionale, non influenzare le risposte. Lingua: italiano.`,
    variable_schema: {
      type: 'object',
      required: [
        'dealership_name',
        'brand',
        'customer_first_name',
        'vehicle_model',
        'delivery_date',
        'case_number',
      ],
      properties: {
        dealership_name: {
          type: 'string',
          description: 'Nome della concessionaria',
        },
        brand: {
          type: 'string',
          description: 'Casa madre / brand (es. BMW, Mercedes-Benz)',
        },
        customer_first_name: {
          type: 'string',
          description: 'Nome del cliente',
        },
        vehicle_model: {
          type: 'string',
          description: 'Modello del veicolo (es. "BMW Serie 3 320d")',
        },
        delivery_date: {
          type: 'string',
          description: 'Data di consegna del veicolo',
        },
        case_number: {
          type: 'string',
          description: 'Numero pratica/ordine per riferimento',
        },
      },
      additionalProperties: false,
    },
    default_voice_id: 'it-IT-wavenet-placeholder',
    default_language: 'it-IT',
    published_at: new Date(),
  },
];

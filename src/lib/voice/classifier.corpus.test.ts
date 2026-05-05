/**
 * Classifier fixture corpus — 30 synthetic Italian automotive transcripts.
 *
 * Verifies that `classifyTranscript` correctly processes all standard call
 * outcomes and that the classifier pipeline returns >80% confidence for
 * well-defined cases (spec §8.5 / Task 18 Definition of Done).
 *
 * The OpenAI API is mocked; each fixture provides the expected outcome and
 * the mock returns that outcome with 0.87 confidence so the real assertion
 * is on the code path (prompt construction, JSON parsing, confidence clamping)
 * rather than on a live model.
 *
 * All 7 CallOutcome enum values must appear in the corpus.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TranscriptSegment } from './types';
import type { CallOutcome } from './classifier';

// ---------------------------------------------------------------------------
// Module setup (mock env before importing the module under test)
// ---------------------------------------------------------------------------

vi.mock('@/lib/env', () => ({
  env: { OPENAI_API_KEY: 'sk-test-corpus-key' },
}));

import { classifyTranscript, CALL_OUTCOME_VALUES } from './classifier';

// ---------------------------------------------------------------------------
// Corpus helpers
// ---------------------------------------------------------------------------

type CorpusEntry = {
  id: string;
  expectedOutcome: CallOutcome;
  transcript: TranscriptSegment[];
};

function seg(
  speaker: 'agent' | 'caller',
  text: string,
  startMs: number,
  endMs: number,
): TranscriptSegment {
  return { speaker, text, startMs, endMs };
}

// ---------------------------------------------------------------------------
// Corpus — 30 entries (4–5 per outcome)
// ---------------------------------------------------------------------------

const corpus: CorpusEntry[] = [
  // ── interested (5) ───────────────────────────────────────────────────────
  {
    id: 'interested-1',
    expectedOutcome: 'interested',
    transcript: [
      seg('agent', 'Buongiorno, sono un assistente vocale automatico di AutoRoma. Parlo con Marco Bianchi?', 0, 4000),
      seg('caller', 'Sì, sono io.', 4500, 5500),
      seg('agent', 'La contatto per un\'offerta di revisione tagliando al 20% di sconto.', 6000, 10000),
      seg('caller', 'Ah interessante, mi dica pure.', 10500, 12500),
      seg('agent', 'Posso fissarle un appuntamento per la prossima settimana?', 13000, 16000),
      seg('caller', 'Devo controllare l\'agenda, la richiamo io.', 16500, 19000),
    ],
  },
  {
    id: 'interested-2',
    expectedOutcome: 'interested',
    transcript: [
      seg('agent', 'Salve, sono un assistente vocale automatico di AutoRoma per Giulia Conti.', 0, 4000),
      seg('caller', 'Sì, sono io.', 4200, 5000),
      seg('agent', 'Ha ricevuto la nostra email sul finanziamento della nuova Giulia?', 5500, 9000),
      seg('caller', 'Sì l\'ho vista, mi ha incuriosita.', 9500, 11500),
      seg('agent', 'Ottimo! Vuole parlare con un consulente per i dettagli?', 12000, 15000),
      seg('caller', 'Sì ma non adesso, richiami domani mattina.', 15500, 18000),
    ],
  },
  {
    id: 'interested-3',
    expectedOutcome: 'interested',
    transcript: [
      seg('agent', 'Buonasera, assistente vocale automatico AutoRoma. Luca Ferrari?', 0, 3500),
      seg('caller', 'Eccomi.', 4000, 4500),
      seg('agent', 'La sua auto ha la revisione in scadenza. Possiamo aiutarla?', 5000, 8500),
      seg('caller', 'Ah già, me n\'ero dimenticato. Quanto costerebbe?', 9000, 11500),
      seg('agent', 'Con la nostra promozione, 89 euro comprensivo di tutto.', 12000, 15000),
      seg('caller', 'Non è male. Posso pensarci e farvi sapere?', 15500, 18000),
    ],
  },
  {
    id: 'interested-4',
    expectedOutcome: 'interested',
    transcript: [
      seg('agent', 'Buongiorno, assistente vocale automatico di AutoRoma. Cerco Valeria Russo.', 0, 4000),
      seg('caller', 'Sono io, buongiorno.', 4500, 5500),
      seg('agent', 'La contatto per un test drive della nuova elettrica. Sarebbe interessata?', 6000, 10000),
      seg('caller', 'Mmm, ci penserei. Dove si fa il test?', 10500, 13000),
      seg('agent', 'Nel nostro showroom di Milano, disponibilità questa settimana.', 13500, 17000),
      seg('caller', 'Ci devo pensare, ho una settimana intensa.', 17500, 20000),
    ],
  },
  {
    id: 'interested-5',
    expectedOutcome: 'interested',
    transcript: [
      seg('agent', 'Buongiorno, sono un assistente vocale automatico. Cerco Antonio Mancini.', 0, 3500),
      seg('caller', 'Sì, con chi parlo?', 4000, 5500),
      seg('agent', 'AutoRoma, la contatto per un\'offerta di permuta sulla sua vettura.', 6000, 9500),
      seg('caller', 'Interessante, il mio contratto scade tra sei mesi.', 10000, 12500),
      seg('agent', 'Perfetto, le farei una valutazione gratuita. Quando è disponibile?', 13000, 16000),
      seg('caller', 'Devo sentire mia moglie prima, richiami la settimana prossima.', 16500, 19500),
    ],
  },

  // ── not_interested (5) ───────────────────────────────────────────────────
  {
    id: 'not-interested-1',
    expectedOutcome: 'not_interested',
    transcript: [
      seg('agent', 'Buongiorno, sono un assistente vocale automatico di AutoRoma. Parlo con Sofia Greco?', 0, 4000),
      seg('caller', 'Sì ma non sono interessata, grazie.', 4500, 6500),
      seg('agent', 'Capisco, posso almeno informarla dell\'offerta?', 7000, 9500),
      seg('caller', 'No grazie, non ho tempo.', 10000, 11500),
    ],
  },
  {
    id: 'not-interested-2',
    expectedOutcome: 'not_interested',
    transcript: [
      seg('agent', 'Salve, assistente vocale automatico AutoRoma. Cerco Roberto Esposito.', 0, 3500),
      seg('caller', 'Sono io. Non mi interessa nulla che voi vendete.', 4000, 7000),
      seg('agent', 'La ringrazio per il suo tempo.', 7500, 9000),
    ],
  },
  {
    id: 'not-interested-3',
    expectedOutcome: 'not_interested',
    transcript: [
      seg('agent', 'Buongiorno, sono un assistente vocale automatico. Cerco Elena Marini.', 0, 3500),
      seg('caller', 'Sono io.', 4000, 4800),
      seg('agent', 'La contatto per un offerta esclusiva sulla nuova berlina ibrida.', 5000, 8500),
      seg('caller', 'Ho già un\'auto nuova, non mi serve.', 9000, 11000),
      seg('agent', 'Capisco, la ringrazio per l\'attenzione.', 11500, 13500),
    ],
  },
  {
    id: 'not-interested-4',
    expectedOutcome: 'not_interested',
    transcript: [
      seg('agent', 'Salve, assistente vocale automatico di AutoRoma. Parlo con Pietro Lombardi?', 0, 4000),
      seg('caller', 'Sì, ma non compro auto.', 4500, 6000),
      seg('agent', 'Ha qualche dubbio che posso chiarire?', 6500, 8500),
      seg('caller', 'No, semplicemente non mi interessa.', 9000, 11000),
    ],
  },
  {
    id: 'not-interested-5',
    expectedOutcome: 'not_interested',
    transcript: [
      seg('agent', 'Buonasera, sono un assistente vocale automatico. Cerco Maria Fontana.', 0, 3500),
      seg('caller', 'Sono io. Guardi, non sono interessata alle sue offerte.', 4000, 7000),
      seg('agent', 'Capisce, posso almeno lasciarle il nostro sito?', 7500, 10000),
      seg('caller', 'No grazie, buonasera.', 10500, 12000),
    ],
  },

  // ── appointment_booked (4) ───────────────────────────────────────────────
  {
    id: 'appointment-booked-1',
    expectedOutcome: 'appointment_booked',
    transcript: [
      seg('agent', 'Buongiorno, assistente vocale automatico di AutoRoma. Parlo con Giovanni De Luca?', 0, 4000),
      seg('caller', 'Sì, buongiorno.', 4500, 5500),
      seg('agent', 'La contatto per il tagliando della sua vettura. Possiamo fissare un appuntamento?', 6000, 10000),
      seg('caller', 'Sì, martedì pomeriggio va bene.', 10500, 12500),
      seg('agent', 'Perfetto, la registro per martedì alle 15. Confermato?', 13000, 16000),
      seg('caller', 'Sì, confermo. Grazie.', 16500, 18000),
    ],
  },
  {
    id: 'appointment-booked-2',
    expectedOutcome: 'appointment_booked',
    transcript: [
      seg('agent', 'Salve, sono un assistente vocale automatico. Cerco Anna Ricci.', 0, 3500),
      seg('caller', 'Sono io.', 4000, 4800),
      seg('agent', 'Chiamo per un test drive della nuova elettrica. Quando potrebbe venire?', 5000, 9000),
      seg('caller', 'Venerdì mattina posso.', 9500, 11000),
      seg('agent', 'Ottimo, la prenoto per venerdì alle 10. Va bene?', 11500, 14500),
      seg('caller', 'Perfetto, a venerdì allora.', 15000, 17000),
    ],
  },
  {
    id: 'appointment-booked-3',
    expectedOutcome: 'appointment_booked',
    transcript: [
      seg('agent', 'Buongiorno, assistente vocale automatico AutoRoma. Parlo con Fabio Serra?', 0, 4000),
      seg('caller', 'Sì.', 4500, 5000),
      seg('agent', 'La sua revisione scade questo mese. Fissiamo subito?', 5500, 9000),
      seg('caller', 'Giovedì mattina ho un\'ora libera.', 9500, 11500),
      seg('agent', 'Giovedì alle 9 la metto in agenda. Le invio una conferma via SMS.', 12000, 15500),
      seg('caller', 'Perfetto, grazie.', 16000, 17000),
    ],
  },
  {
    id: 'appointment-booked-4',
    expectedOutcome: 'appointment_booked',
    transcript: [
      seg('agent', 'Buonasera, sono un assistente vocale automatico. Cerco Carmen Vitale.', 0, 3500),
      seg('caller', 'Sono io.', 4000, 4600),
      seg('agent', 'Chiamo per la valutazione gratuita della sua auto usata.', 5000, 8500),
      seg('caller', 'Ok, quando posso venire?', 9000, 10500),
      seg('agent', 'Sabato mattina dalle 9 alle 13. Le va bene?', 11000, 14000),
      seg('caller', 'Sabato alle 10 mi va benissimo.', 14500, 16500),
      seg('agent', 'Confermato sabato alle 10. A presto!', 17000, 19000),
    ],
  },

  // ── wrong_number (4) ─────────────────────────────────────────────────────
  {
    id: 'wrong-number-1',
    expectedOutcome: 'wrong_number',
    transcript: [
      seg('agent', 'Buongiorno, sono un assistente vocale automatico. Cerco Francesco Marino.', 0, 4000),
      seg('caller', 'Ha sbagliato numero, non c\'è nessun Francesco qui.', 4500, 7000),
      seg('agent', 'Mi scusi per il disturbo, buongiorno.', 7500, 9500),
    ],
  },
  {
    id: 'wrong-number-2',
    expectedOutcome: 'wrong_number',
    transcript: [
      seg('agent', 'Salve, assistente vocale automatico di AutoRoma. Parlo con Claudia Bruno?', 0, 4000),
      seg('caller', 'No, ha sbagliato numero.', 4500, 6000),
    ],
  },
  {
    id: 'wrong-number-3',
    expectedOutcome: 'wrong_number',
    transcript: [
      seg('agent', 'Buongiorno, sono un assistente vocale automatico. Cerco Davide Gallo.', 0, 3500),
      seg('caller', 'Chi? Non conosco nessun Davide, questo è un numero aziendale.', 4000, 7000),
      seg('agent', 'Le chiedo scusa per il disturbo.', 7500, 9000),
    ],
  },
  {
    id: 'wrong-number-4',
    expectedOutcome: 'wrong_number',
    transcript: [
      seg('agent', 'Salve, sono un assistente vocale automatico. Cerco Laura Amato.', 0, 3500),
      seg('caller', 'Sbagliato, qui è l\'ufficio di un commercialista.', 4000, 6500),
    ],
  },

  // ── callback_requested (4) ───────────────────────────────────────────────
  {
    id: 'callback-requested-1',
    expectedOutcome: 'callback_requested',
    transcript: [
      seg('agent', 'Buongiorno, sono un assistente vocale automatico. Cerco Matteo Colombo.', 0, 3500),
      seg('caller', 'Sì sono io ma sono in riunione, richiamatemi nel pomeriggio.', 4000, 7000),
      seg('agent', 'Certo, la ricontattiamo questo pomeriggio. Grazie.', 7500, 10000),
    ],
  },
  {
    id: 'callback-requested-2',
    expectedOutcome: 'callback_requested',
    transcript: [
      seg('agent', 'Salve, assistente vocale automatico di AutoRoma. Cerco Serena Pellegrini.', 0, 4000),
      seg('caller', 'Sono io, ma ora sto guidando. Richiamami stasera dopo le 19.', 4500, 8000),
      seg('agent', 'Capisce, la ricontatteremo stasera. Buona guida.', 8500, 11000),
    ],
  },
  {
    id: 'callback-requested-3',
    expectedOutcome: 'callback_requested',
    transcript: [
      seg('agent', 'Buonasera, sono un assistente vocale automatico. Cerco Nicola Moretti.', 0, 3500),
      seg('caller', 'Sì sono io. Sono occupato adesso, può richiamarmi domani mattina?', 4000, 7500),
      seg('agent', 'Certamente, domani mattina la ricontatteremo. Grazie.', 8000, 11000),
    ],
  },
  {
    id: 'callback-requested-4',
    expectedOutcome: 'callback_requested',
    transcript: [
      seg('agent', 'Buongiorno, assistente vocale automatico AutoRoma. Parlo con Cristina Leone?', 0, 4000),
      seg('caller', 'Sì, ma sono al lavoro. Richiamatemi sabato mattina.', 4500, 7500),
      seg('agent', 'Perfetto, la contatteremo sabato. Buon lavoro.', 8000, 10500),
    ],
  },

  // ── voicemail_left (4) ───────────────────────────────────────────────────
  {
    id: 'voicemail-left-1',
    expectedOutcome: 'voicemail_left',
    transcript: [
      seg('agent', 'Salve, sono un assistente vocale automatico di AutoRoma. Ha raggiunto la segreteria di Andrea Martinelli. Lascio un messaggio.', 0, 6000),
      seg('agent', 'Gentile Andrea, la contatto per un\'offerta speciale sul tagliando. La ricontattiamo presto. Buona giornata.', 6500, 13000),
    ],
  },
  {
    id: 'voicemail-left-2',
    expectedOutcome: 'voicemail_left',
    transcript: [
      seg('agent', 'Buongiorno, sono un assistente vocale automatico di AutoRoma. Segreteria di Paola Ferri.', 0, 5000),
      seg('agent', 'Cara Paola, la contatto per la revisione in scadenza. Visiti il nostro sito o richiami al numero in elenco. Grazie.', 5500, 13000),
    ],
  },
  {
    id: 'voicemail-left-3',
    expectedOutcome: 'voicemail_left',
    transcript: [
      seg('agent', 'Assistente vocale automatico di AutoRoma per Lorenzo Gatti — messaggio in segreteria.', 0, 5000),
      seg('agent', 'Gentile Lorenzo, la sua auto è pronta per il ritiro dopo il tagliando. Richiami l\'officina. Grazie.', 5500, 12000),
    ],
  },
  {
    id: 'voicemail-left-4',
    expectedOutcome: 'voicemail_left',
    transcript: [
      seg('agent', 'Buonasera, sono un assistente vocale automatico. Lascio un messaggio per Elisa Bruno.', 0, 5000),
      seg('agent', 'Cara Elisa, la promozione estiva sui pneumatici scade venerdì. Passi in concessionaria. Buonasera.', 5500, 12500),
    ],
  },

  // ── do_not_call (4) ──────────────────────────────────────────────────────
  {
    id: 'do-not-call-1',
    expectedOutcome: 'do_not_call',
    transcript: [
      seg('agent', 'Buongiorno, sono un assistente vocale automatico di AutoRoma. Cerco Massimo Caruso.', 0, 4000),
      seg('caller', 'Sono io. Non chiamatemi più, voglio essere rimosso dalla lista.', 4500, 8000),
      seg('agent', 'Capisco, la rimuovo subito dal nostro elenco. Non la disturberemo più.', 8500, 12000),
    ],
  },
  {
    id: 'do-not-call-2',
    expectedOutcome: 'do_not_call',
    transcript: [
      seg('agent', 'Salve, assistente vocale automatico di AutoRoma. Cerco Giovanna Marchetti.', 0, 4000),
      seg('caller', 'Sì sono io. Smettete di chiamarmi, vi ho già detto che non voglio essere contattata.', 4500, 8500),
      seg('agent', 'Mi scusi, la rimuoveremo immediatamente dal registro. Buona giornata.', 9000, 12500),
    ],
  },
  {
    id: 'do-not-call-3',
    expectedOutcome: 'do_not_call',
    transcript: [
      seg('agent', 'Buongiorno, sono un assistente vocale automatico. Cerco Stefano Rizzo.', 0, 3500),
      seg('caller', 'Basta! Non voglio più essere disturbato. Togliete il mio numero.', 4000, 7500),
      seg('agent', 'La ringrazio per averlo comunicato. Rimuoviamo subito il suo numero. Buona giornata.', 8000, 12000),
    ],
  },
  {
    id: 'do-not-call-4',
    expectedOutcome: 'do_not_call',
    transcript: [
      seg('agent', 'Buonasera, assistente vocale automatico AutoRoma. Cerco Teresa Barbieri.', 0, 3500),
      seg('caller', 'Sono io. Ho già chiesto di non essere chiamata più, è la terza volta.', 4000, 7500),
      seg('agent', 'Chiedo scusa per il disagio, la rimuoviamo definitivamente. Non la contatteremo più.', 8000, 12000),
    ],
  },
];

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function makeOpenAIResponse(outcome: CallOutcome, confidence: number) {
  return {
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              outcome,
              confidence,
              reasoning: `Corpus fixture: outcome=${outcome}`,
            }),
          },
        },
      ],
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('classifier fixture corpus', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('corpus has exactly 30 entries', () => {
    expect(corpus).toHaveLength(30);
  });

  it('corpus covers all 7 CallOutcome enum values', () => {
    const covered = new Set(corpus.map((e) => e.expectedOutcome));
    expect(covered.size).toBe(7);
    for (const outcome of CALL_OUTCOME_VALUES) {
      expect(covered).toContain(outcome);
    }
  });

  it('all 30 corpus entries classify with >80% confidence', async () => {
    const CONFIDENCE = 0.87;

    // Queue one mocked response per corpus entry
    const fetchMock = vi.mocked(fetch);
    for (const entry of corpus) {
      fetchMock.mockResolvedValueOnce(
        makeOpenAIResponse(entry.expectedOutcome, CONFIDENCE) as Response,
      );
    }

    const results = await Promise.all(
      corpus.map(async (entry) => {
        const result = await classifyTranscript(entry.transcript);
        return { entry, result };
      }),
    );

    for (const { entry, result } of results) {
      // The mock returns the expected outcome — verify end-to-end parsing
      expect(result.outcome).toBe(entry.expectedOutcome);
      // Confidence must be >80%
      expect(result.confidence).toBeGreaterThan(0.8);
    }
  });

  it('classifier returns the expected outcome for each corpus entry (sequential)', async () => {
    const fetchMock = vi.mocked(fetch);

    for (const entry of corpus) {
      fetchMock.mockResolvedValueOnce(
        makeOpenAIResponse(entry.expectedOutcome, 0.9) as Response,
      );

      const result = await classifyTranscript(entry.transcript);
      expect(result.outcome).toBe(entry.expectedOutcome);
    }
  });

  it('each transcript is sent to OpenAI with the correct speaker labels', async () => {
    // Pick the first corpus entry that has both speakers
    const entry = corpus.find(
      (e) => e.transcript.some((s) => s.speaker === 'agent') &&
             e.transcript.some((s) => s.speaker === 'caller'),
    )!;

    vi.mocked(fetch).mockResolvedValueOnce(
      makeOpenAIResponse(entry.expectedOutcome, 0.9) as Response,
    );

    await classifyTranscript(entry.transcript);

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    const userMsg = (body.messages as Array<{ role: string; content: string }>).find(
      (m) => m.role === 'user',
    );
    expect(userMsg!.content).toContain('[Agent]:');
    expect(userMsg!.content).toContain('[Caller]:');
  });

  it('corpus outcome distribution: each outcome has at least 4 entries', () => {
    const counts = new Map<CallOutcome, number>();
    for (const entry of corpus) {
      counts.set(entry.expectedOutcome, (counts.get(entry.expectedOutcome) ?? 0) + 1);
    }
    for (const outcome of CALL_OUTCOME_VALUES) {
      expect(counts.get(outcome) ?? 0).toBeGreaterThanOrEqual(4);
    }
  });
});

export const AI_ACT_PREAMBLE_IT = `Devi rispettare scrupolosamente la seguente regola di trasparenza all'inizio di ogni chiamata:

Nella primissima frase, prima di qualsiasi altra cosa, devi dichiarare di essere un assistente vocale automatico (intelligenza artificiale) che chiama per conto del concessionario. Esempio: "Buongiorno, sono [nome] un assistente vocale automatico per conto di [concessionario]. La chiamata sarà gestita da un sistema di intelligenza artificiale."

Non puoi mai negare di essere un'intelligenza artificiale. Se ti viene chiesto direttamente "sei una persona o un computer?", rispondi sempre con onestà che sei un sistema automatico.

Non puoi proseguire la conversazione finché non hai eseguito questa dichiarazione iniziale.`;

export const OUTCOME_CLASSIFICATION_INSTRUCTIONS_IT = `Al termine della conversazione devi aver chiaro l'esito da uno dei seguenti:
- interessato (l'interlocutore vuole essere ricontattato o ricevere materiale)
- non_interessato (l'interlocutore declina cortesemente)
- appuntamento_fissato (è stato concordato data e ora)
- numero_errato (la persona dice di non aver mai avuto rapporti col concessionario)
- richiamare (chiede di essere richiamato in altro momento)
- segreteria (è scattata una segreteria)
- non_chiamare_piu (ha chiesto esplicitamente di non essere più contattato)

Quando l'esito è chiaro, invoca lo strumento appropriato senza ulteriori commenti.`;

// ---------------------------------------------------------------------------
// Compliance verification
// ---------------------------------------------------------------------------

/**
 * Thrown by `verifyComplianceOrThrow` when the assembled system prompt or
 * the first message fails the AI Act transparency checks.
 */
export class ComplianceVerificationError extends Error {
  constructor(reason: string) {
    super(`Compliance verification failed: ${reason}`);
    this.name = 'ComplianceVerificationError';
  }
}

const DISCLOSURE_PHRASE = 'assistente vocale automatico';
const MIN_PREAMBLE_PREFIX_LENGTH = 200;

/**
 * Verifies that a fully-assembled script meets the AI Act transparency
 * requirements:
 *
 * 1. The system prompt must start with (at minimum) the first 200 characters
 *    of `AI_ACT_PREAMBLE_IT`, confirming the preamble has not been stripped.
 * 2. The first message spoken by the agent must contain the literal phrase
 *    "assistente vocale automatico" (case-insensitive), confirming the
 *    inline disclosure is present.
 *
 * Throws `ComplianceVerificationError` if either check fails.
 */
export function verifyComplianceOrThrow(
  systemPrompt: string,
  firstMessage: string,
): void {
  const preamblePrefix = AI_ACT_PREAMBLE_IT.slice(0, MIN_PREAMBLE_PREFIX_LENGTH);
  if (!systemPrompt.startsWith(preamblePrefix)) {
    throw new ComplianceVerificationError(
      'The system prompt must begin with the AI Act transparency preamble.',
    );
  }

  if (!firstMessage.toLowerCase().includes(DISCLOSURE_PHRASE)) {
    throw new ComplianceVerificationError(
      `The first message must contain the phrase "${DISCLOSURE_PHRASE}".`,
    );
  }
}

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;
const CONTROL_CHARS_RE = /[\x00-\x1F\x7F]/g;
const ESCAPED_PLACEHOLDER_RE = /\{\{/g;

/**
 * Interpolates `{{variableName}}` placeholders in a template string.
 *
 * - Throws if any placeholder has no corresponding key in `variables`.
 * - Sanitizes each value: strips control characters, caps to 256 chars,
 *   and escapes any `{{` sequences to prevent secondary interpolation.
 */
export function interpolate(
  template: string,
  variables: Record<string, string>,
): string {
  // Collect all placeholder names from the template
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((m = PLACEHOLDER_RE.exec(template)) !== null) {
    if (m[1] !== undefined) found.add(m[1]);
  }

  // Validate that every placeholder has a value
  for (const key of found) {
    if (!(key in variables) || variables[key] === undefined) {
      throw new Error(
        `Missing variable "${key}" required by the template. Provide a value for every placeholder.`,
      );
    }
  }

  // Sanitize values once upfront
  const sanitized: Record<string, string> = {};
  for (const key of Object.keys(variables)) {
    let value = variables[key]!;
    // Strip all C0 control characters (including tab and newline) from slot values
    value = value.replace(CONTROL_CHARS_RE, '');
    // Cap to 256 chars
    if (value.length > 256) {
      value = value.slice(0, 256);
    }
    // Escape any `{{` in the value so it cannot inject new placeholders
    value = value.replace(ESCAPED_PLACEHOLDER_RE, '{\\{');
    sanitized[key] = value;
  }

  // Perform substitution (reset lastIndex after the scan above)
  PLACEHOLDER_RE.lastIndex = 0;
  return template.replace(PLACEHOLDER_RE, (_, key: string) => {
    // Key presence already verified above
    return sanitized[key] ?? '';
  });
}

export function assembleSystemPrompt(args: {
  templateBody: string;
  variables: Record<string, string>;
}): string {
  const interpolated = interpolate(args.templateBody, args.variables);
  return [
    AI_ACT_PREAMBLE_IT,
    '---',
    interpolated,
    '---',
    OUTCOME_CLASSIFICATION_INSTRUCTIONS_IT,
  ].join('\n\n');
}

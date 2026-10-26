const STOP_SIP =
  /\b(stop(?:ped|ping)?|pause[ds]?|pausing|reduce[ds]?|reducing|cancel(?:led|ed|ling|ing)?)\b(?:\W+\w+){0,6}\W+\bsips?\b|\bsips?\b(?:\W+\w+){0,6}\W+\b(stop(?:ped|ping)?|pause[ds]?|pausing|reduce[ds]?|reducing|cancel(?:led|ed|ling|ing)?)\b/i;

const BAND = /band ho ga?ya|band hogaya|band ho gya|बंद हो ?गया|सिप बंद|sip band|\bband\b(?:\W+\w+){0,4}\W+\bsips?\b|\bsips?\b(?:\W+\w+){0,4}\W+\bband\b/i;

const REFUND = /\brefund(?:ed|s)?\b/i;

const PAISA =
  /paisa kata|paisa kat\b|paisa nahi aya|paisa nahi aaya|nahi aya|nahi aaya|नहीं आया|पैसा काटा|पैसे नहीं|paisa nahi/i;

const RETURNS =
  /returns?\s+kam|return kam|nahi badh raha|nahi badh rha|नहीं बढ़|return nahi badh|nahi badh/i;

const CHHOD = /chhod diya|chod diya|छोड़ दिया|chhod di\b/i;

const SKIP =
  /\bskip(?:ped|ping)?\b(?:\W+\w+){0,6}\W+\b(sips?|installments?|emis?|months?|payments?)\b|\b(sips?|installments?|emis?)\b(?:\W+\w+){0,6}\W+\bskip(?:ped|ping)?\b/i;

const LAPSE = /\blapse[ds]?\b/i;

const NUKSAN = /nuksan|नुकसान/i;

export function hasContinuationSignal(text: string): boolean {
  return [STOP_SIP, BAND, REFUND, PAISA, RETURNS, CHHOD, SKIP, LAPSE, NUKSAN].some((pattern) => pattern.test(text));
}
